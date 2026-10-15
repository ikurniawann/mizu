import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), queryOne: vi.fn(), withTransaction: vi.fn() }));

const {
  contractActionSchema,
  employmentStatusOnActivate,
  mergeDraftEdit,
  renewalStartDate,
  syncSalaryFromContract,
} = await import("./contracts-lifecycle");

const draft = {
  id: "c1",
  employee_id: "e1",
  contract_number: "0001/PKWTT/I/2026",
  contract_type: "pkwtt" as const,
  status: "draft",
  start_date: "2026-01-01",
  end_date: null,
  probation_end_date: "2026-03-31",
  base_salary: "5000000",
  position_title: "Barista",
  department_name: "Ops",
  work_location: "Jakarta",
  notes: "awal",
  signed_at: null,
  kemnaker_registered_at: null,
  compensation_paid_at: null,
  sequence: 1,
};

describe("employmentStatusOnActivate", () => {
  it("PKWT selalu contract", () => {
    expect(employmentStatusOnActivate({ contract_type: "pkwt", probation_end_date: null }, "2026-01-01")).toBe(
      "contract"
    );
  });
  it("PKWTT masih masa percobaan → probation", () => {
    expect(employmentStatusOnActivate(draft, "2026-02-01")).toBe("probation");
    expect(employmentStatusOnActivate(draft, "2026-03-31")).toBe("probation");
  });
  it("PKWTT lewat masa percobaan atau tanpa percobaan → permanent", () => {
    expect(employmentStatusOnActivate(draft, "2026-04-01")).toBe("permanent");
    expect(employmentStatusOnActivate({ ...draft, probation_end_date: null }, "2026-01-01")).toBe("permanent");
  });
});

describe("renewalStartDate", () => {
  it("sehari setelah kontrak lama berakhir, lintas tahun", () => {
    expect(renewalStartDate("2026-12-31")).toBe("2027-01-01");
    expect(renewalStartDate("2028-02-28")).toBe("2028-02-29");
  });
});

describe("mergeDraftEdit", () => {
  it("undefined mempertahankan, null mengosongkan", () => {
    const merged = mergeDraftEdit(draft, { action: "edit", work_location: null, base_salary: 6000000 });
    expect(merged.start_date).toBe("2026-01-01");
    expect(merged.work_location).toBeNull();
    expect(merged.base_salary).toBe(6000000);
    expect(merged.notes).toBe("awal");
  });
});

describe("contractActionSchema", () => {
  it("menerima path hasil upload kontrak", () => {
    const parsed = contractActionSchema.safeParse({
      action: "update",
      signed_document_url: "contract-signed/0b6c1d2e-aaaa/1700000000000-abcdef.pdf",
    });
    expect(parsed.success).toBe(true);
  });
  it.each(["attendance/emp-x/a.jpg", "contract-signed/../x/a.pdf", "contract-signed/a/../../b.pdf"])(
    "menolak path %s",
    (path) => {
      expect(contractActionSchema.safeParse({ action: "update", signed_document_url: path }).success).toBe(false);
    }
  );
  it("aksi tak dikenal memakai pesan Indonesia", () => {
    const parsed = contractActionSchema.safeParse({ action: "hapus" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0].message).toBe("Aksi tidak dikenal");
  });
});

describe("syncSalaryFromContract", () => {
  const fakeClient = (entities: number) => {
    const query = vi.fn().mockResolvedValue({ rows: [{ entities }] });
    return { client: { query } as unknown as Parameters<typeof syncSalaryFromContract>[0], query };
  };

  it("karyawan digaji lebih dari satu entitas: tidak mengubah apa pun", async () => {
    const { client, query } = fakeClient(2);
    await syncSalaryFromContract(client, draft);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain("count(DISTINCT company_id)");
  });

  it("satu entitas: versi aktif dibaca lalu versi baru membawa company_id-nya", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ entities: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: "s1", base_salary: "4000000", company_id: "co-1" }] })
      .mockResolvedValue({ rows: [] });
    await syncSalaryFromContract({ query } as unknown as Parameters<typeof syncSalaryFromContract>[0], draft);
    const insert = query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO hris.employee_salary"));
    expect(insert).toBeDefined();
    expect(insert![1][insert![1].length - 1]).toBe("co-1");
  });
});
