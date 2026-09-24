"use client";
import { Fragment } from "react";
import { FLASKEHALS, KASTEBORD, KASTEBORDET, PROEVER } from "../../../data/fremskrivning";
import { kr } from "../../lib/agent-cost";
import { AGENT_ENGINE_LABEL, lineOpsFor } from "../../lib/agents";
import { kasserKoert, ledNavn, type HudAgent, type HudLink, type HudModel, type HudOrdre, type LinkTone } from "../../lib/ai-hud";
import {
  flowLimits, rateFrom, runSegments, RUN_STATE_LABEL, type RunState,
} from "../../lib/flow";
import type { KanalSpec } from "../../../data/fremskrivning";
import { ctMulti, ctPris, graenseFor, type Fraktion } from "../../lib/proever";
import { kildeTekst, klokke, varighed, type Besked } from "../../lib/samspil";
import { graense, type MaskinLaesning, type OrdreStatus, type TelemetriBillede } from "../../lib/telemetri";
import { Afkod, Bjaelke, Kurve, Maaler, Oscilloskop, Tal } from "./Instrumenter";
import { TAKT_MS, type Historik } from "./useTelemetri";

/**
 * Panelerne rundt om hologrammet.
 *
 * Alt her kommer fra HudModel og TelemetriBillede. Komponenterne regner
 * ingenting nyt ud — de vælger, hvad der skal stå hvor. Tekstreglen gælder:
 * labels på højst fire ord, ingen forklarende sætninger.
 *
 * Et tomt felt står som "Afventer signal", aldrig som et nul.
 */

export const klok = (t: number) =>
  new Date(t).toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Et panel med hjørnebeslag. `nr` styrer rækkefølgen, de tændes i ved opstart. */
export function Panel({ label, right, children, className = "", nr = 0, still }: {
  label: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  nr?: number;
  still?: boolean;
}) {
  return (
    <section className={`hud-panel ${className}`} style={{ ["--i" as string]: nr }}>
      <header className="hp-head">
        <span className="hp-label"><Afkod tekst={label} forsinkelse={300 + nr * 110} still={still} /></span>
        {right}
      </header>
      {children}
    </section>
  );
}

/** Mærkatet på simulerede tal. Det følger tallet, ikke siden. */
export const Sim = () => <span className="hp-sim" title="Simuleret — ikke målt">SIM</span>;

const Afventer = ({ tekst = "Afventer signal" }: { tekst?: string }) => (
  <p className="hp-afventer"><span className="hp-afventer-mark" aria-hidden />{tekst}</p>
);

// ---------------------------------------------------------------------------
// Ordren

/**
 * Hvad linjen kører. Der er ingen forbindelse til ordresystemet endnu, så i
 * den rigtige visning står felterne tomme — og i demoen er de opdigtede og
 * mærket.
 */
/** Hvor ordren er: en fase, eller hvornår sidste kasse er tippet. */
function faerdigTekst(s: OrdreStatus): string {
  if (s.fase === "opstart") return "Opstart";
  if (s.fase === "udloeb") return "Udløb";
  if (s.fase === "faerdig") return s.slutT !== null ? klokke(s.slutT) : "Færdig";
  // En prognose er et estimat, og den står stille, mens måleren er ude.
  return s.prognoseT !== null ? `ca. ${klokke(s.prognoseT)}` : "–";
}

export function OrdrePanel({ ordre, nominal, gennemloeb, status = null, nr, still }: {
  ordre: HudOrdre;
  /** 100 %-punktet i t/hr. Uden det kan strømmen ikke blive til kasser. */
  nominal: number | null;
  gennemloeb: number | null;
  /** Ordren i simuleringen. Når den kører, er det dens kasser, der tælles. */
  status?: OrdreStatus | null;
  nr: number;
  still?: boolean;
}) {
  const koert = status ? status.kasserTippet : kasserKoert(ordre, nominal, gennemloeb);
  const felter: { label: string; value: string | null; bar?: boolean }[] = [
    { label: "Ordre nr.", value: ordre.ordreNr },
    { label: "Genetik", value: ordre.genetik },
    { label: "Varietet", value: ordre.varietet },
    { label: "Est. kg", value: ordre.estimeretKg === null ? null : ordre.estimeretKg.toLocaleString("da-DK") },
    // Kørte kasser ud af ordrens. Kendes ordren, men ikke strømmen, står
    // der en streg — ikke et nul.
    { label: "Box", value: ordre.kasser === null ? null : `${koert ?? "–"} / ${ordre.kasser}`, bar: true },
    ...(status ? [{ label: "Færdig", value: faerdigTekst(status) }] : []),
  ];
  return (
    <Panel label="Ordre" nr={nr} still={still} right={ordre.opdigtet ? <Sim /> : undefined}>
      <dl className="hp-ordre">
        {felter.map((f) => (
          <div key={f.label} className={f.bar && !status ? "is-bred" : undefined}>
            <dt>{f.label}</dt>
            <dd className={f.value ? undefined : "is-tom"}>{f.value ?? "Ikke udfyldt"}</dd>
            {/* Bjælken kun, når tallet kendes: en tom bjælke ligner et nul. */}
            {f.bar && ordre.kasser !== null && koert !== null && <Bjaelke v={koert} max={ordre.kasser} />}
          </div>
        ))}
      </dl>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Scenens overskrift

/**
 * Det vigtigste lige nu, midt i scenen.
 *
 * Er kæden brudt, er det bruddet. Halter den, er det flaskehalsen — er data
 * forsinkede, er alt andet på skærmen forældet, og det er vigtigere end én
 * maskine. Ellers det, der er galt i anlægget: en alarm før et stop, et
 * stop før ingenting. Kører alt, siger den det — med flowet som bevis.
 */
export function Overskrift({ model, billede, still }: {
  model: HudModel;
  billede: TelemetriBillede;
  still?: boolean;
}) {
  if (model.broken) return <Brud link={model.broken} tone={model.chainTone} still={still} />;

  // Data-forsinkelsen tager overskriften, når den betyder noget: når
  // Driftsagenten ikke længere kan stole på det, den ser. Under det viser
  // kæden den selv.
  const k = billede.kaede;
  if (k?.flaskehals && k.forsinkelseS > FLASKEHALS.forsinkelseAlarmS) {
    return (
      <div className="hud-break tone-brud">
        <p className="hb-kicker"><span className="hb-dot" aria-hidden />Flaskehals · {ledNavn(model.links, k.flaskehals).toUpperCase()}{billede.simuleret && <Sim />}</p>
        <p className="hb-where">Data <Tal v={k.forsinkelseS} d={0} /> s bagud</p>
        <p className="hb-next">
          <span className="hb-next-label">Kø</span>
          <strong><Tal v={k.koe} d={0} /> rækker</strong>
          {k.aarsag && (
            <>
              <span className="hb-next-label">Årsag</span>
              <strong>{k.aarsag}</strong>
            </>
          )}
        </p>
      </div>
    );
  }

  const whr = rateFrom(billede.flowPct, model.flow.nominal);

  // Driftsagenten har stoppet noget. Så længe det står på dens beslutning,
  // er det det vigtigste: hvad den gjorde, hvorfor, og hvad det koster.
  const ai = billede.ai;
  const aiStop = ai?.spor.filter((x) => x.stoppet) ?? [];
  if (ai && (aiStop.length > 0 || ai.indgangStoppet)) {
    const hvad = ai.indgangStoppet ? "Indgangen stoppet" : `Spor ${aiStop.map((x) => x.lane).join(" og ")} stoppet`;
    const hvorfor = aiStop[0]?.aarsag;
    return (
      <div className="hud-break tone-test is-ai">
        <p className="hb-kicker">
          <span className="hb-ai">AI</span>Driftsagent{billede.simuleret && <Sim />}
        </p>
        <p className="hb-where">{hvad}</p>
        <p className="hb-next">
          {hvorfor && (<><span className="hb-next-label">Årsag</span><strong>{hvorfor}</strong></>)}
          {whr !== null && (<><span className="hb-next-label">W/HR</span><strong><Tal v={whr} d={2} /> {model.flow.rateUnit}</strong></>)}
        </p>
      </div>
    );
  }

  // Ordrens faser: at starte, at løbe tom og at være færdig er ikke alarmer,
  // men det er det vigtigste, der sker, mens det sker.
  const o = billede.ordre;
  if (o && o.fase !== "koerer") {
    const kicker = o.fase === "opstart" ? "Opstart · bagfra" : o.fase === "udloeb" ? "Udløb · forfra" : `Ordre ${o.ordreNr} færdig`;
    return (
      <div className={`hud-break ${o.fase === "faerdig" ? "tone-drift" : "tone-test is-ai"}`}>
        <p className="hb-kicker"><span className="hb-ai">AI</span>{kicker}<Sim /></p>
        <p className="hb-where">
          {o.fase === "faerdig"
            ? `${o.kasserTippet} kasser · ${varighed(((o.slutT ?? billede.t) - o.startT) / 1000)}`
            : `${billede.koerende} af ${billede.maskiner.length} kører`}
        </p>
        <p className="hb-next">
          <span className="hb-next-label">Box</span>
          <strong>{o.kasserTippet} / {o.kasser}</strong>
        </p>
      </div>
    );
  }

  const alarm = billede.haendelser.find((h) => h.niveau === "alarm" && billede.t - h.t < 20_000);
  // Maskiner, agenten har stoppet, er ikke fejl og hører ikke til her.
  const staar = billede.maskiner.filter((m) => m.koerer === false && !m.styret);

  if (alarm) {
    return (
      <div className="hud-break tone-brud">
        <p className="hb-kicker"><span className="hb-dot" aria-hidden />Alarm · {alarm.hvor}{billede.simuleret && <Sim />}</p>
        <p className="hb-where">{alarm.tekst}</p>
        <p className="hb-next"><span className="hb-next-label">{klok(alarm.t)}</span></p>
      </div>
    );
  }
  if (staar.length > 0) {
    return (
      <div className="hud-break tone-brud is-stop">
        <p className="hb-kicker"><span className="hb-dot" aria-hidden />{staar.length === 1 ? "Stoppet" : `${staar.length} stoppet`}{billede.simuleret && <Sim />}</p>
        <p className="hb-where">{staar.slice(0, 3).map((m) => m.kort).join(" · ")}</p>
        <p className="hb-next">
          <span className="hb-next-label">Kører</span>
          <strong>{billede.koerende} / {billede.maskiner.length}</strong>
        </p>
      </div>
    );
  }
  return (
    <div className={`hud-break is-whole tone-${billede.simuleret ? "drift" : model.chainTone}`}>
      <p className="hb-kicker">{billede.simuleret ? "Alle maskiner kører" : "Kæden er hel"}{billede.simuleret && <Sim />}</p>
      <p className="hb-where">
        {billede.flowPct === null
          ? "Linjen kører"
          : whr !== null
            ? <><Tal v={whr} d={2} /> {model.flow.rateUnit}</>
            : <><Tal v={billede.flowPct} d={1} /> %</>}
      </p>
      {billede.flowPct !== null && (
        <p className="hb-next">
          <span className="hb-next-label">{whr !== null ? "W/HR ved indgang" : "Flow ved indgang"}</span>
          {whr !== null && <strong><Tal v={billede.flowPct} d={0} /> %</strong>}
        </p>
      )}
    </div>
  );
}

function Brud({ link, tone, still }: { link: HudLink; tone: LinkTone; still?: boolean }) {
  return (
    <div className={`hud-break tone-${tone}`}>
      <p className="hb-kicker"><span className="hb-dot" aria-hidden />Kæden stopper ved</p>
      <p className="hb-where"><Afkod tekst={link.label} forsinkelse={900} still={still} /></p>
      {link.next && (
        <p className="hb-next">
          <span className="hb-next-label">Afventer</span>
          <strong>{link.next}</strong>
        </p>
      )}
    </div>
  );
}

/**
 * Det store udlæste tal: hvor mange maskiner har deres signaler på plads.
 *
 * Etiketten er HUD-ordet, ikke "i drift". Om en maskine *kører*, står i
 * driftspanelet — og står et spor på Driftsagentens beslutning, ville "i
 * drift 26" ved siden af "kører 16" være en modsigelse. Farven tændes kun,
 * når der er noget at farve.
 */
export function Readout({ tally, sim = false }: { tally: HudModel["tally"]; sim?: boolean }) {
  return (
    <div className="hud-readout">
      {sim && <Sim />}
      <span className={`ro-group${tally.drift > 0 ? " is-drift" : ""}`}>
        <span className="ro-label">På plads</span>
        <Tal v={tally.drift} d={0} className="ro-value" />
        <span className="ro-of">/ {tally.total}</span>
      </span>
      <span className={`ro-group${tally.test > 0 ? " is-test" : ""}`}>
        <span className="ro-label">Test</span>
        <Tal v={tally.test} d={0} className="ro-value" />
      </span>
      <span className="ro-group">
        <span className="ro-label">Afventer</span>
        <Tal v={tally.afventer} d={0} className="ro-value" />
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flowet ved indgangen

/** Kører / kører ikke / sensorfejl — udledt af forløbet, ikke af én prøve. */
function tilstandAf(serie: (number | null)[]): RunState | null {
  if (serie.length === 0) return null;
  const segs = runSegments(serie.map((value, i) => ({ t: i * TAKT_MS, value })));
  return segs.length ? segs[segs.length - 1].state : null;
}

const RUN_TONE: Record<RunState, string> = { koerer: "drift", staar: "moerk", fejl: "brud" };

export function FlowPanel({ model, billede, historik, sim, nr, still }: {
  model: HudModel;
  billede: TelemetriBillede;
  historik: Historik;
  sim: boolean;
  nr: number;
  still?: boolean;
}) {
  const ops = lineOpsFor(model.lineId);
  const graenser = flowLimits(ops);
  const signal = model.flow.signal ?? "FT-743";
  const rate = rateFrom(billede.flowPct, model.flow.nominal);
  const tilstand = tilstandAf(historik.get("flow") ?? []);
  const tone = tilstand ? RUN_TONE[tilstand] : "moerk";

  return (
    <Panel label={`Flow · ${signal}`} nr={nr} still={still} className="hp-flow" right={sim ? <Sim /> : undefined}>
      <div className="hp-flow-top">
        <Maaler
          v={billede.flowPct}
          min={0}
          max={150}
          enhed="%"
          tone={tone}
          zoner={[[0, graenser.lowPct, "lav"], [graenser.lowPct, graenser.highPct, "ok"], [graenser.highPct, 150, "hoej"]]}
        />
        <div className="hp-flow-side">
          <span className={`hp-run run-${tilstand ?? "ukendt"}`}>
            {tilstand ? RUN_STATE_LABEL[tilstand] : "Afventer"}
          </span>
          {/* W/HR: vægt pr. time. Det tal, driften spørger efter først. */}
          <div className="hp-whr">
            <span className="hp-whr-label">
              W/HR
              {model.flow.kilde === "skoen" && <span className="hp-skoen" title="100 %-punktet er et skøn, ikke aftalt">Skøn</span>}
            </span>
            {rate === null
              ? <span className="hp-ikke">Ikke udfyldt</span>
              : <span className="hp-whr-tal"><Tal v={rate} d={2} /><i>{model.flow.rateUnit}</i></span>}
          </div>
          <dl className="hp-kv">
            <div><dt>Råsignal</dt><dd><Tal v={billede.flowMa} d={2} /> <i>mA</i></dd></div>
          </dl>
        </div>
      </div>
      <Oscilloskop serie={historik.get("flowMa") ?? []} />
    </Panel>
  );
}

// ---------------------------------------------------------------------------

export function DriftPanel({ billede, historik, nr, still }: {
  billede: TelemetriBillede;
  historik: Historik;
  nr: number;
  still?: boolean;
}) {
  // Driftssignalerne kendes, når maskinerne melder, om de kører — også før
  // der er oppetid at regne på, som under en opstart.
  const kendt = billede.oppetidPct !== null || billede.maskiner.some((m) => m.koerer !== null);
  // Rødt er en fejl. Står maskinerne kun på Driftsagentens beslutning, er
  // tallet rav — et styret stop må ikke se ud som noget, der er gået galt.
  const fejl = billede.maskiner.some((m) => m.koerer === false && !m.styret);
  const styrede = billede.maskiner.some((m) => m.styret);
  const koererTone = fejl ? " is-brud" : styrede ? " is-styret" : "";
  return (
    <Panel label="Drift" nr={nr} still={still} right={billede.simuleret ? <Sim /> : undefined}>
      {!kendt ? (
        <Afventer tekst="Afventer driftssignaler" />
      ) : (
        <>
          <div className="hp-tre">
            <div className="hp-stort">
              <span className="hp-stort-label">Oppetid</span>
              <span className="hp-stort-tal"><Tal v={billede.oppetidPct} d={1} /><i>%</i></span>
            </div>
            <div className="hp-stort">
              <span className="hp-stort-label">Kører</span>
              <span className={`hp-stort-tal${koererTone}`}>
                <Tal v={billede.koerende} d={0} /><i>/ {billede.maskiner.length}</i>
              </span>
            </div>
            <div className="hp-stort">
              <span className="hp-stort-label">Stop</span>
              <span className="hp-stort-tal"><Tal v={billede.stop} d={0} /></span>
            </div>
          </div>
          <Kurve serie={historik.get("oppetid") ?? []} tone="drift" hoejde={28} />
        </>
      )}
    </Panel>
  );
}

export function KlimaPanel({ billede, historik, nr, still }: {
  billede: TelemetriBillede;
  historik: Historik;
  nr: number;
  still?: boolean;
}) {
  const har = billede.hal.some((k) => k.value !== null);
  return (
    <Panel label="Hallen" nr={nr} still={still} right={billede.simuleret ? <Sim /> : undefined}>
      {!har ? <Afventer /> : (
        <div className="hp-klima">
          {billede.hal.map((k) => (
            <div key={k.spec.id} className={`hp-klima-rk${k.alarm ? " is-alarm" : ""}`}>
              <span className="hp-klima-lbl">{k.spec.label}<Graense k={k.spec} /></span>
              <span className="hp-klima-tal"><Tal v={k.value} d={k.spec.decimaler} /><i>{k.spec.unit}</i></span>
              <Kurve serie={historik.get(`hal:${k.spec.id}`) ?? []} tone={k.alarm ? "brud" : "drift"} hoejde={22} graense={k.spec.alarmHoej !== undefined ? [k.spec.alarmHoej] : undefined} />
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Kvaliteten

/**
 * Klassificeringen af frøet på hvert kastebord: FV0–FV3 over et bånd, så
 * man både kan læse dem og se, hvem der dominerer, og under dem BIGF, BIGH,
 * NOTS og det, der gik til den lette ende. Det er output — hvad bordet gør
 * ved frøet — og står derfor her og ikke på maskinen.
 */
/**
 * Laboratoriet: hvad CT-scanneren og videometeret har gang i, og det seneste
 * svar fra hvert kastebord. Et svar er en prøve — taget på et bestemt
 * tidspunkt og først kendt tyve minutter efter. Derfor står tiden ved hvert tal.
 *
 * Kastebordene vises på det, de vurderes efter: multigerm i Ready og prisen
 * i Heavy og Light — gode frø smidt ud pr. uønsket. Et Ready uden for bordets
 * grænse er rav — det kan en agent rette. Det sidste bords Ready er
 * færdigvaren; er det uden for, er det en fejl og rødt. En høj pris er ikke
 * en fejl, men noget at åbne bordet for, og har ingen farve.
 */
export function LaboratoriePanel({ billede, nr, still }: { billede: TelemetriBillede; nr: number; still?: boolean }) {
  const lab = billede.laboratorie;
  const vm = lab.seneste.filter((p) => p.videometer).sort((a, b) => b.taget - a.taget)[0] ?? null;
  const borde = billede.maskiner.filter((m) => KASTEBORD.test(m.navn));
  const svar = (id: string, f: Fraktion) => lab.seneste.find((p) => p.sted.maskine === id && p.sted.fraktion === f) ?? null;
  const kraftig = Object.values(billede.sortering).some((x) => x === "kraftig");
  const tom = !lab.ct.igang && !lab.videometer.igang && lab.seneste.length === 0;
  return (
    <Panel label="Laboratoriet" nr={nr} still={still} right={billede.simuleret ? <Sim /> : undefined}>
      {tom ? <Afventer /> : (
        <div className="hp-lab">
          <div className="hp-lab-instr">
            <span className="hp-lab-navn">CT</span>
            {lab.ct.igang
              ? <span className="hp-lab-igang">{lab.ct.igang.sted.navn}<i className="fm-num">svar {klokke(lab.ct.igang.svarT)}</i></span>
              : <span className="hp-lab-ledig">Ledig</span>}
          </div>
          <div className="hp-lab-instr">
            <span className="hp-lab-navn">Videometer</span>
            {lab.videometer.igang
              ? <span className="hp-lab-igang">Kasse {lab.videometer.igang.kasse + 1}<i className="fm-num">svar {klokke(lab.videometer.igang.svarT)}</i></span>
              : <span className="hp-lab-ledig">Ledig</span>}
          </div>
          {vm?.videometer && (
            <p className={`hp-lab-vm fm-num${vm.videometer.fremmedIalt > PROEVER.videometer.fremmedHoej ? " is-over" : ""}`}>
              Kasse {(vm.kasse ?? 0) + 1} · {vm.videometer.fremmedIalt} foreign seeds <i>{klokke(vm.taget)}</i>
            </p>
          )}
          <div className="hp-lab-borde">
            <span />
            <span>Ready<br />multigerm</span>
            <span>Heavy<br />pr. uønsket</span>
            <span>Light<br />pr. uønsket</span>
            {borde.map((m) => {
              const ready = svar(m.id, "ready");
              const heavy = svar(m.id, "heavy");
              const light = svar(m.id, "light");
              const bord = ready?.sted.bord ?? heavy?.sted.bord ?? light?.sted.bord ?? 0;
              const g = graenseFor(bord);
              const sidst = bord === KASTEBORDET.graenser.length - 1;
              // Hvert tal står med sin prøvetid: et svar kan være timer gammelt.
              const celle = (p: typeof ready, v: number | null, d: number, enhed: string, graense: number | null, fejl = false) => (
                <span className={`hp-lab-v fm-num${v !== null && graense !== null && v > graense ? (fejl ? " is-fejl" : " is-over") : ""}`}>
                  {v === null || !p ? "–" : <>{v.toFixed(d).replace(".", ",")}<i>{enhed}</i><em className="hp-lab-t">{klokke(p.taget)}</em></>}
                </span>
              );
              return (
                <Fragment key={m.id}>
                  <span className="hp-kb-navn">{m.kort}</span>
                  {celle(ready, ready?.ct ? ctMulti(ready.ct) : null, 1, "%", g.readyMulti, sidst)}
                  {celle(heavy, heavy?.ct ? ctPris(heavy.ct) : null, 0, "", null)}
                  {celle(light, light?.ct ? ctPris(light.ct) : null, 0, "", null)}
                </Fragment>
              );
            })}
          </div>
          <p className="hp-note">
            Triøre {kraftig ? "kraftig" : "normal"} · {lab.ct.taget} CT · {lab.videometer.taget} videometer
          </p>
        </div>
      )}
    </Panel>
  );
}

const komma1 = (v: number) => v.toFixed(1).replace(".", ",");

/** Grænsen ved en kanals navn. Har den ingen, står der ingenting. */
function Graense({ k }: { k: KanalSpec }) {
  const g = graense(k);
  return g ? <b className="hp-graense">{g}</b> : null;
}

// ---------------------------------------------------------------------------
// Maskinen i fokus

export function FokusPanel({ m, historik, sim }: { m: MaskinLaesning | null; historik: Historik; sim: boolean }) {
  if (!m) return null;
  const tilstand = m.alarm ? "alarm" : m.styret ? "styret" : m.koerer === false ? "staar" : m.koerer ? "koerer" : "ukendt";
  return (
    <section className={`hud-fokus t-${tilstand}`} key={m.id}>
      <header className="hf-head">
        <span className="hf-navn">{m.kort}</span>
        <span className="hf-id">W-{m.wIds.join(" · W-")}{m.lane ? ` · Spor ${m.lane}` : ""}</span>
        {sim && <Sim />}
        <span className="hf-tilstand">
          {tilstand === "alarm" ? "Alarm" : tilstand === "styret" ? "Stoppet af AI" : tilstand === "staar" ? "Stoppet" : tilstand === "koerer" ? "Kører" : "Afventer"}
        </span>
      </header>
      {m.kanaler.every((k) => k.value === null) ? <Afventer /> : (
        <div className="hf-kanaler">
          {m.kanaler.map((k) => (
            <div key={k.spec.id} className={`hf-kanal${k.alarm ? " is-alarm" : ""}`}>
              <span className="hf-lbl">{k.spec.label}<Graense k={k.spec} /></span>
              <span className="hf-tal"><Tal v={k.value} d={k.spec.decimaler} /><i>{k.spec.unit}</i></span>
              <Kurve
                serie={historik.get(`m:${m.id}:${k.spec.id}`) ?? []}
                tone={k.alarm ? "brud" : "drift"}
                hoejde={26}
                graense={[k.spec.alarmHoej, k.spec.alarmLav].filter((g): g is number => g !== undefined)}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Hændelserne

export function Haendelser({ billede, nr, still, onAaben }: {
  billede: TelemetriBillede;
  nr: number;
  still?: boolean;
  /** Åbn loggen, man kan læse igennem. */
  onAaben: () => void;
}) {
  return (
    <Panel
      label="Hændelser"
      nr={nr}
      still={still}
      className="hp-log"
      right={
        <span className="hp-hoejre">
          {billede.simuleret ? <Sim /> : <span className="hp-count fm-num">{billede.haendelser.length}</span>}
          <button type="button" className="hp-knap" onClick={onAaben} aria-haspopup="dialog">Hele loggen</button>
        </span>
      }
    >
      {billede.haendelser.length === 0 ? (
        <Afventer tekst={billede.simuleret ? "Ingen hændelser endnu" : "Ingen signaler at melde fra"} />
      ) : (
        <ol className="hp-haendelser">
          {billede.haendelser.slice(0, 14).map((h) => (
            <li key={`${h.t}-${h.hvor}-${h.tekst}`} className={`n-${h.niveau}`}>
              <time>{klok(h.t)}</time>
              <span className="hh-hvor">{h.ai && <span className="hh-ai">AI</span>}{h.hvor}</span>
              <span className="hh-tekst">{h.tekst}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Agenterne

const AI_TILSTAND: Record<NonNullable<TelemetriBillede["ai"]>["tilstand"], string> = {
  overvaager: "Overvåger",
  handler: "Handler",
  holder: "Holder",
};

function Core({ a, ai, sim, taler = false }: { a: HudAgent; ai: TelemetriBillede["ai"]; sim: boolean; taler?: boolean }) {
  const R = 13;
  const OMKREDS = 2 * Math.PI * R;
  const andel = a.total > 0 ? a.done / a.total : 0;
  return (
    <li className={`hud-core st-${a.state}${a.idea ? " is-idea" : ""}${a.sovende ? " is-sleeping" : ""}${taler ? " is-taler" : ""}`}>
      <svg viewBox="0 0 32 32" className="hc-ring" aria-hidden>
        <circle cx="16" cy="16" r={R} className="hc-track" />
        <circle cx="16" cy="16" r={R} className="hc-arc" strokeDasharray={`${andel * OMKREDS} ${OMKREDS}`} transform="rotate(-90 16 16)" />
        {a.state === "paa-plads" && (
          <>
            <circle cx="16" cy="16" r="7" className="hc-kerne-glod" />
            <circle cx="16" cy="16" r="4" className="hc-kerne" />
          </>
        )}
      </svg>
      <div className="hc-body">
        <span className="hc-name">{a.name}</span>
        <span className="hc-meta">
          <span className="hc-state">{a.statusLabel}</span>
          <span className="hc-sep" aria-hidden>·</span>
          <span className="hc-steps fm-num">{a.done}/{a.total}</span>
          <span className="hc-sep" aria-hidden>·</span>
          <span className="hc-engine">{AGENT_ENGINE_LABEL[a.engine]}</span>
        </span>
        {/* Den agent, der styrer, siger hvad den gør lige nu. */}
        {a.styring && ai && (
          <span className={`hc-ai t-${ai.tilstand}`}>
            <span className="hh-ai">AI</span>
            {AI_TILSTAND[ai.tilstand]}
            {ai.tilstand === "handler" && ai.seneste && ` · ${ai.seneste.tekst.split(" · ")[0]}`}
            {sim && <Sim />}
          </span>
        )}
      </div>
    </li>
  );
}

export function AgentCores({ model, nr, still, ai = null, sim = false, samtale = [] }: {
  model: HudModel;
  nr: number;
  still?: boolean;
  ai?: TelemetriBillede["ai"];
  sim?: boolean;
  /** Agenterne imellem, nyeste først. Den seneste besked står under panelet. */
  samtale?: Besked[];
}) {
  const besluttet = model.agents.filter((a) => !a.idea);
  const ideer = model.agents.filter((a) => a.idea);
  const senest = samtale[0] ?? null;
  return (
    <Panel
      label="Agenter"
      nr={nr}
      still={still}
      className="hp-agents"
      right={<span className="hp-count fm-num">{kr(model.totalKr)} / md.</span>}
    >
      <ul className="hud-cores">
        {besluttet.map((a) => <Core key={a.id} a={a} ai={ai} sim={sim} taler={senest?.fra === a.name} />)}
      </ul>
      {/* Den seneste besked mellem agenterne. Hele samtalen står i loggen. */}
      {senest && (
        <p className="hp-senest" key={senest.nr}>
          <span className="hs-fra">{senest.fra}</span>
          <span className="hs-pil" aria-hidden>→</span>
          <span className="hs-til">{senest.til}</span>
          <span className={`hs-kilde${senest.kilde === "claude" ? " is-claude" : ""}`}>{kildeTekst(senest, false)}</span>
          <Sim />
          <span className="hs-tekst">{senest.tekst}</span>
        </p>
      )}
      {/* Idéerne på én linje: de er tænkt, ikke besluttet, og skal ikke tage
          pladsen fra dem, der arbejder. */}
      {ideer.length > 0 && (
        <p className="hp-sub hp-ideer">Idéer · ikke medregnet<span>{ideer.map((a) => a.name).join(" · ")}</span></p>
      )}
    </Panel>
  );
}
