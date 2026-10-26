import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SpaTrainingPage } from "./training-page";
import { MyTrainingPage } from "./my-training-page";

afterEach(() => vi.unstubAllGlobals());
const training = { id: "tr1", name: "Teknik Dasar", topic_code: "DASAR", period: "2026-A", training_date: "2026-10-26", trainer_name: "Ibu Trainer", notes: "", participant_count: 1, passed_count: 1 };
function mockApi() {
  const writes: { url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method && init.method !== "GET") writes.push({ url, body: JSON.parse(String(init.body)) });
    const data = url.endsWith("/level-requirements") ? { level_1: [], level_2: [] }
      : url.endsWith("/candidates") ? [
        { therapist_id: "t1", full_name: "Sari", branch_id: "b1", branch_name: "Dago", level: 0, employment_status: "contract", is_active: true, status: "", reviewed_at: null, can_enroll: true, reason: "", similar_passes: [{ name: "Teknik Dasar", period: "2025-A" }], missing_trainings: ["Teknik Dasar (2026-A)"] },
        { therapist_id: "t2", full_name: "Dewi", branch_id: "b1", branch_name: "Dago", level: 1, employment_status: "permanent", is_active: true, status: "passed", reviewed_at: "2026-10-26T10:00:00Z", can_enroll: false, reason: "Sudah lulus", similar_passes: [], missing_trainings: [] },
      ] : url.endsWith("/participants") ? []
      : url.endsWith("/me/trainings") ? { therapist: { full_name: "Sari", level: 0, employment_cycle: 2 }, participations: [{ id: "p1", training_name: "Teknik Dasar", period: "2025-A", trainer_name: "Ibu Trainer", training_date: "2025-10-26", status: "passed", employment_cycle: 1, notes: "Lulus", reviewed_by: "Admin", reviewed_at: "2025-10-27T00:00:00Z" }], progress: [{ target_level: 1, training_id: "tr1", training_name: "Teknik Dasar", period: "2026-A", passed: false }], history: [] }
      : [training];
    return new Response(JSON.stringify({ success: true, data }), { status: 200 });
  }));
  return writes;
}
function mount(node: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{node}</QueryClientProvider>);
}

it("keeps level requirements in a separate Training tab and saves selected training IDs", async () => {
  const writes = mockApi();
  mount(<SpaTrainingPage canCreate canUpdate />);
  await screen.findByText("Teknik Dasar");
  fireEvent.click(screen.getByRole("tab", { name: "Pengaturan Level" }));
  const group = await screen.findByRole("group", { name: "Level 0 → Level 1" });
  fireEvent.click(within(group).getByRole("checkbox", { name: /Teknik Dasar.*2026-A/ }));
  fireEvent.click(screen.getByRole("button", { name: "Simpan syarat level" }));
  await waitFor(() => expect(writes).toContainEqual({ url: "/api/spa/level-requirements", body: { level_1: ["tr1"], level_2: [] } }));
});

it("excludes graduates by default, shows similar-period history and enrolls only selectable candidates", async () => {
  const writes = mockApi();
  mount(<SpaTrainingPage canCreate canUpdate />);
  fireEvent.click(await screen.findByRole("button", { name: "Kelola peserta Teknik Dasar 2026-A" }));
  fireEvent.click(await screen.findByRole("button", { name: "Tambah peserta" }));
  const dialog = screen.getByRole("dialog");
  await within(dialog).findByText("Sari");
  expect(within(dialog).queryByText("Dewi")).not.toBeInTheDocument();
  expect(within(dialog).getByText(/2025-A/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Tampilkan semua terapis" }));
  expect(within(dialog).getByRole("checkbox", { name: "Pilih Dewi" })).toBeDisabled();
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Pilih Sari" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Daftarkan 1 peserta" }));
  await waitFor(() => expect(writes).toContainEqual({ url: "/api/spa/trainings/tr1/participants", body: { therapist_ids: ["t1"] } }));
});

it("shows previous employment training separately from current level progress", async () => {
  mockApi(); mount(<MyTrainingPage />);
  expect(await screen.findByText("Level 0")).toBeInTheDocument();
  expect(screen.getByText("Periode kerja sebelumnya")).toBeInTheDocument();
  expect(screen.getByText("Belum terpenuhi")).toBeInTheDocument();
});

it("does not offer create or update actions to a read-only administrator", async () => {
  mockApi(); mount(<SpaTrainingPage canCreate={false} canUpdate={false} />);
  await screen.findByText("Teknik Dasar");
  expect(screen.queryByRole("button", { name: "Training baru" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Pengaturan Level" }));
  expect(await screen.findByRole("group", { name: "Level 0 → Level 1" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Simpan syarat level" })).not.toBeInTheDocument();
});
