"use client";
import type { ProeveOverblik, SvarKort } from "../../lib/proeveoverblik";
import { tabPct } from "../../lib/proeveoverblik";
import { klokke, tal, varighed } from "../../lib/samspil";

/**
 * Prøvetagningen på kontoret: hvad CT-scanneren har gang i og står for tur,
 * kastebordenes seneste svar, de kilo godt frø, Heavy og Light har taget, og
 * videometerets foreign seeds med sorteringen på Triørerne.
 *
 * Et svar er en prøve, taget på et bestemt tidspunkt — tiden står ved hvert
 * tal. Kiloene er et skøn og siger det. Kun Ready har en grænse: et Ready
 * uden for er rav, det sidste bords Ready rødt. En dyr side er noget at åbne
 * bordet for, ikke en fejl, og har ingen farve.
 */
export function ProeveBoks({ p }: { p: ProeveOverblik | null }) {
  if (!p) return <p className="hp-afventer"><span className="hp-afventer-mark" aria-hidden />Afventer ordre</p>;
  const pct = p.tab ? tabPct(p.tab) : null;
  const vm = p.videometer.seneste;
  return (
    <div className="pb">
      <dl className="pb-ct">
        <dt>CT</dt>
        <dd>
          {p.ct.igang
            ? <>{p.ct.igang.navn}<i>OP {p.ct.igang.opnr ?? "–"}</i><i className="fm-num">svar {klokke(p.ct.igang.svarT)}</i></>
            : <span className="pb-dim">Ledig</span>}
        </dd>
        <dt>Næste</dt>
        <dd>{p.ct.naeste.map((n) => n.navn).join(" · ") || "–"}</dd>
        <dt>Runde</dt>
        <dd className="fm-num">
          {varighed(p.ct.rundeMin * 60)} · {p.ct.taget} taget{p.ct.sprunget > 0 ? ` · ${p.ct.sprunget} sprunget` : ""}
        </dd>
      </dl>

      <div className="pb-tab">
        <span className="pb-lbl">Godt frø tabt</span>
        <span className="pb-stor fm-num">{p.tab ? `${tal(p.tab.godtKg)} kg` : "–"}</span>
        <span className="pb-dim fm-num">{pct !== null ? `${tal(pct, 1)} % af godt frø` : ""}</span>
        <span className="pb-skoen">Skøn</span>
      </div>

      <div className="pb-borde" role="table" aria-label="Kastebordene">
        <span role="columnheader" />
        <span role="columnheader">Ready<br />multigerm</span>
        <span role="columnheader">Heavy<br />godt · pr. uønsket</span>
        <span role="columnheader">Light<br />godt · pr. uønsket</span>
        {/* Kiloene hviler på et skøn — også de enkelte bords, ikke kun summen. */}
        <span role="columnheader">Tabt godt frø<br /><span className="pb-skoen">Skøn</span></span>
        {p.borde.map((r) => (
          <div key={r.maskine} role="row" className="pb-raekke">
            <span className="pb-kb">{r.kort}</span>
            <Celle s={r.ready} vis={(s) => `${tal(s.multi, 1)} %`} />
            <Celle s={r.heavy} vis={(s) => `${tal(s.godt, 1)} % · ${tal(s.pris)}`} />
            <Celle s={r.light} vis={(s) => `${tal(s.godt, 1)} % · ${tal(s.pris)}`} />
            <span className="pb-v fm-num">
              {r.tabKg === null ? "–" : `${tal(r.tabKg)} kg`}
              {r.tabKgPrT !== null && <em>{tal(r.tabKgPrT, 1)} kg/t</em>}
            </span>
          </div>
        ))}
      </div>

      {p.jetpealere.length > 0 && (
        <dl className="pb-jet">
          {p.jetpealere.map((j) => (
            <div key={j.lane}>
              <dt>{j.navn}<i>OP {j.opnr ?? "–"}</i></dt>
              <dd className="fm-num">
                {j.svar
                  ? <>multigerm {tal(j.svar.multi, 1)} % · NOTS {j.svar.notsStk}{j.svar.mg !== null ? ` · ${tal(j.svar.mg, 1)} mg` : ""}<em>{klokke(j.svar.taget)}</em></>
                  : "–"}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="pb-vm">
        <span className="pb-lbl">Videometer</span>
        {vm ? (
          <>
            <span className={`pb-vm-tal fm-num${vm.stk > p.videometer.hoej ? " is-over" : ""}`}>
              Kasse {vm.kasse} · {vm.stk} foreign seeds<em>{klokke(vm.taget)}</em>
            </span>
            <span className="pb-arter">{vm.arter.slice(0, 5).map((a) => `${a.art} ${a.stk}`).join(" · ") || "Ingen"}</span>
            <span className="pb-dim fm-num">Slibeskader {tal(vm.slibeskader, 1)} %</span>
          </>
        ) : <span className="pb-dim">{p.videometer.igang ? `Kasse ${p.videometer.igang.kasse + 1} · svar ${klokke(p.videometer.igang.svarT)}` : "Intet svar endnu"}</span>}
        <span className="pb-dim fm-num">
          Triøre {p.sortering === "kraftig" ? "kraftig" : "normal"} · grænse {p.videometer.hoej} / {p.videometer.lav}
        </span>
      </div>
    </div>
  );
}

function Celle({ s, vis }: { s: SvarKort | null; vis: (s: SvarKort) => string }) {
  if (!s) return <span className="pb-v fm-num">–</span>;
  return (
    <span className={`pb-v fm-num${s.niveau === "fejl" ? " is-fejl" : s.niveau === "over" ? " is-over" : ""}`}>
      {vis(s)}<em>{klokke(s.taget)}</em>
    </span>
  );
}
