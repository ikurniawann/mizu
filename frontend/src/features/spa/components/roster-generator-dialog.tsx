"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogFooter, DialogPanel, DialogPanelBody, DialogPanelDescription, DialogPanelHeader, DialogPanelTitle } from "@/components/ui/dialog";
import { applyRoster, previewRoster, type RosterPreview } from "../roster-generation";
import { SELECT } from "./shared";

type Shift = { id: string; name: string; start_time: string; end_time: string; is_active: boolean };
export function RosterGeneratorDialog({ branchId, outletName, initialMonth, shifts, onClose, onSaved }: { branchId: string; outletName: string; initialMonth: string; shifts: Shift[]; onClose: () => void; onSaved: (date: string) => void }) {
 const qc = useQueryClient();
 const active = shifts.filter(s=>s.is_active);
 const [month,setMonth]=useState(initialMonth);
 const [ids,setIds]=useState(active.map(s=>s.id));
 const [replace,setReplace]=useState(false);
 const [preview,setPreview]=useState<RosterPreview|null>(null);
 const [dirty,setDirty]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const request={branch_id:branchId,month,shift_ids:ids,replace_existing:replace};
 async function run(action:"generate"|"validate"|"apply") {
  setBusy(true);setError("");
  try {
   const input=action==="generate"?request:{...request,cells:preview?.cells,revision:preview?.revision};
   const result=await (action==="apply"?applyRoster(input):previewRoster(input));
   setPreview(result);setDirty(false);
   if(action==="apply") {await Promise.all([qc.invalidateQueries({queryKey:["spa"]}),qc.invalidateQueries({queryKey:["users","shift-schedule"]}),qc.invalidateQueries({queryKey:["hris"]})]);toast.success("Jadwal bulanan diterapkan");onSaved(`${month}-01`);}
  } catch(e) {setError(e instanceof Error?e.message:"Jadwal gagal diproses");if(action==="apply")setDirty(true);} finally {setBusy(false);}
 }
 const cells=(preview?.cells??[]).filter(c=>c.date.startsWith(month));
 const dates=[...new Set(cells.map(c=>c.date))].sort();
 const employees=[...new Map(cells.map(c=>[c.employee_id,c.name])).entries()];
 function reset(){setPreview(null);setError("");setDirty(false);}
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogPanel size="2xl" className="sm:max-w-[95vw]">
  <DialogPanelHeader><DialogPanelTitle>Generate jadwal bulanan</DialogPanelTitle><DialogPanelDescription>{outletName} · Minimum perempuan/laki-laki dihitung total per hari dari seluruh shift.</DialogPanelDescription></DialogPanelHeader>
  <DialogPanelBody className="space-y-4">
   <fieldset disabled={busy} className="space-y-3">
    <div className="flex flex-wrap items-center gap-4"><label className="space-y-1 text-sm">Bulan<Input type="month" aria-label="Bulan jadwal" value={month} onChange={e=>{setMonth(e.target.value);reset();}}/></label><label className="flex gap-2 text-sm"><input type="checkbox" checked={replace} onChange={e=>{setReplace(e.target.checked);reset();}}/>Izinkan penggantian jadwal masa depan yang sudah diatur</label></div>
    <div className="flex flex-wrap gap-3">{active.map(s=><label key={s.id} className="flex gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" checked={ids.includes(s.id)} onChange={e=>{setIds(e.target.checked?[...ids,s.id]:ids.filter(id=>id!==s.id));reset();}}/>{s.name} · {s.start_time.slice(0,5)}–{s.end_time.slice(0,5)}</label>)}</div>
    <p className="text-xs text-muted-foreground">Syarat mengikuti pengaturan di tab Jadwal Libur. Cuti, libur disetujui, perbantuan, booking, dan absensi dikunci. Jadwal di luar bulan ini tetap dipakai untuk menghitung libur Senin–Minggu.</p>
    <Button onClick={()=>void run("generate")} disabled={!month||!ids.length||busy}>{busy&&!preview?"Menghitung…":"Generate jadwal"}</Button>
   </fieldset>
   {error&&<p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">{error}</p>}
   {preview&&<>
    <div className="rounded-lg border bg-surface-2 p-3 text-sm">Minimal {preview.quota.min_female} perempuan dan {preview.quota.min_male} laki-laki / hari · Libur {preview.quota.min_per_week??0}–{preview.quota.max_per_week} hari / minggu. {dirty?"Perubahan belum divalidasi.":preview.status==="valid"?"Semua syarat terpenuhi.":"Belum ditemukan jadwal yang memenuhi semua syarat."}</div>
    {preview.violations.length>0&&!dirty&&<div role="alert" className="max-h-40 overflow-auto rounded-lg bg-warning-soft p-3 text-sm"><ul className="list-inside list-disc">{preview.violations.map((v,i)=><li key={i}>{v.date} {cells.find(c=>c.employee_id===v.employee_id)?.name} — {v.message}</li>)}</ul></div>}
    <div className="max-h-[50vh] overflow-auto rounded-lg border"><table className="w-full text-xs"><caption className="sr-only">Pratinjau jadwal bulanan</caption><thead><tr><th className="sticky left-0 z-10 min-w-40 bg-card p-3 text-left">Terapis</th>{dates.map(d=><th key={d} className="min-w-32 bg-surface-2 p-2">{d.slice(8)}<div className="font-normal text-muted-foreground">{cells.filter(c=>c.date===d&&c.branch_id===branchId&&c.kind==="work"&&c.gender==="female").length} P / {cells.filter(c=>c.date===d&&c.branch_id===branchId&&c.kind==="work"&&c.gender==="male").length} L</div></th>)}</tr></thead><tbody>{employees.map(([id,name])=><tr key={id} className="border-t"><th className="sticky left-0 bg-card p-3 text-left">{name}<div className="mt-1 font-normal text-muted-foreground">{cells.filter(c=>c.employee_id===id&&c.kind==="off").length} hari libur bulan ini</div></th>{dates.map(date=>{const index=preview.cells.findIndex(c=>c.employee_id===id&&c.date===date);const c=preview.cells[index];return <td key={date} className="p-1">{c&&<><select aria-label={`${name} ${date}`} className={SELECT} disabled={busy||c.locked} value={c.kind==="work"?c.shift_id:c.kind} onChange={e=>{const value=e.target.value;setPreview({...preview,cells:preview.cells.map((cell,i)=>i===index?{...cell,kind:value==="off"?"off":"work",shift_id:value==="off"?"":value}:cell)});setDirty(true);}}><option value="off">Libur</option><option value="leave" disabled>Cuti</option><option value="unscheduled" disabled>Belum diatur</option>{active.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}{c.shift_id&&!ids.includes(c.shift_id)&&<option value={c.shift_id}>Shift lama</option>}</select>{c.locked&&<p className="p-1 text-[10px] text-muted-foreground">{c.reason||"Terkunci"}</p>}</>}</td>;})}</tr>)}</tbody></table></div>
   </>}
  </DialogPanelBody>
  <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>Batal</Button>{preview&&<><Button variant="outline" disabled={busy||!dirty} onClick={()=>void run("validate")}>Validasi perubahan</Button><Button disabled={busy||dirty||preview.status!=="valid"} onClick={()=>void run("apply")}>Terapkan jadwal</Button></>}</DialogFooter>
 </DialogPanel></Dialog>;
}
