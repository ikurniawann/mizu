import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RosterGeneratorDialog } from "./roster-generator-dialog";
afterEach(()=>vi.unstubAllGlobals());
it("previews without applying, validates edits, then applies the reviewed candidate",async()=>{
 const writes:string[]=[];
 vi.stubGlobal("fetch",vi.fn(async(url,init)=>{
  const path=String(url); if(init?.method==="POST")writes.push(path);
  return new Response(JSON.stringify({success:true,data:path.includes("day-offs")?{quota:{min_female:0,min_male:0,min_per_week:0,max_per_week:2}}:{status:"valid",revision:"rev",quota:{min_female:0,min_male:0,min_per_week:0,max_per_week:2},violations:[],score:0,cells:[{employee_id:"e1",name:"Ayu",date:"2026-11-02",branch_id:"b1",gender:"female",kind:"work",shift_id:"s1",locked:false}]}}));
 }));
 const saved=vi.fn();render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><RosterGeneratorDialog branchId="b1" outletName="Dago" initialMonth="2026-11" shifts={[{id:"s1",name:"Pagi",start_time:"09:00",end_time:"17:00",is_active:true}]} onClose={()=>{}} onSaved={saved}/></QueryClientProvider>);
 fireEvent.click(screen.getByRole("button",{name:"Generate jadwal"}));
 await screen.findByText("Ayu");expect(writes).toEqual(["/api/spa/rosters/preview"]);
 fireEvent.change(screen.getByLabelText("Ayu 2026-11-02"),{target:{value:"off"}});
 expect(screen.getByRole("button",{name:"Terapkan jadwal"})).toBeDisabled();
 fireEvent.click(screen.getByRole("button",{name:"Validasi perubahan"}));
 await waitFor(()=>expect(screen.getByRole("button",{name:"Terapkan jadwal"})).toBeEnabled());
 fireEvent.click(screen.getByRole("button",{name:"Terapkan jadwal"}));
 await waitFor(()=>expect(saved).toHaveBeenCalled());
 expect(writes.at(-1)).toBe("/api/spa/rosters/apply");
});

it("shows a stale server rejection and requires validation before another apply", async () => {
  const saved = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (String(url).endsWith("/apply")) {
      return new Response(JSON.stringify({ success: false, error: "Jadwal telah berubah. Generate ulang." }), { status: 409 });
    }
    return new Response(JSON.stringify({ success: true, data: {
      status: "valid", revision: "rev", quota: { min_female: 1, min_male: 0, min_per_week: 0, max_per_week: 2 },
      violations: [], score: 0, cells: [{ employee_id: "e1", name: "Ayu", date: "2026-11-02", branch_id: "b1", gender: "female", kind: "work", shift_id: "s1", locked: false }],
    } }));
  }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <RosterGeneratorDialog branchId="b1" outletName="Dago" initialMonth="2026-11" shifts={[{ id: "s1", name: "Pagi", start_time: "09:00", end_time: "17:00", is_active: true }]} onClose={() => {}} onSaved={saved} />
  </QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Generate jadwal" }));
  await screen.findByText("Ayu");
  fireEvent.click(screen.getByRole("button", { name: "Terapkan jadwal" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Jadwal telah berubah");
  expect(screen.getByRole("button", { name: "Terapkan jadwal" })).toBeDisabled();
  expect(saved).not.toHaveBeenCalled();
});
