"use client";
import { useEffect } from "react";
import { ANALYSE, DRIFTSAGENT } from "../../../data/fremskrivning";
import type { OtLayout } from "../../lib/ot";
import { kildeTekst, tal, type Besked } from "../../lib/samspil";
import { graense, type Anbefaling, type Haendelse, type MaskinLaesning, type TelemetriBillede } from "../../lib/telemetri";
import { klok, Panel, Sim } from "./HudPanels";
import { Bjaelke, Kurve, Tal } from "./Instrumenter";
import type { Historik } from "./useTelemetri";

/**
 * Enheden, man har klikket på: det, der sker inde i den.
 *
 * Driftstallene med deres grænser og kurver, bufferen foran, og for et
 * kastebord også indstillingerne, klassificeringen af frøet og en åben
 * anbefaling, operatøren kan udføre eller afvise. Nederst målerne — hvor
 * tallene kommer fra — og enhedens egne hændelser og det, agenterne har sagt
 * om den. Alt er læst af det samme billede som resten af skærmen.
 */
export function EnhedPanel({ m, billede, historik, log, samtale, ot, onLuk, onUdfoer, onAfvis }: {
  m: MaskinLaesning;
  billede: TelemetriBillede;
  historik: Historik;
  log: Haendelse[];
  samtale: Besked[];
  ot: OtLayout | null;
  onLuk: () => void;
  onUdfoer?: (id: number) => void;
  onAfvis?: (id: number) => void;
}) {
  // Escape lukker enheden — og kameraet vender tilbage til overblikket.
  useEffect(() => {
    const tast = (e: KeyboardEvent) => { if (e.key === "Escape") onLuk(); };
    addEventListener("keydown", tast);
    return () => removeEventListener("keydown", tast);
  }, [onLuk]);

  const sim = billede.simuleret;
  const tilstand = m.alarm ? "alarm" : m.planlagt ? "planlagt" : m.styret ? "styret" : m.koerer === false ? "staar" : m.koerer ? "koerer" : "ukendt";
  const tilstandTekst = {
    alarm: "Alarm", planlagt: "Slukket efter plan", styret: "Stoppet af AI", staar: "Stoppet", koerer: "Kører", ukendt: "Afventer",
  }[tilstand];
  const ind = billede.indstillinger[m.id] ?? null;
  const analyse = billede.analyse.find((a) => a.id === m.id) ?? null;
  const aaben = billede.anbefalinger.find((a) => a.maskine === m.id && a.status === "aaben") ?? null;
  const tidligere = billede.anbefalinger.filter((a) => a.maskine === m.id && a.status !== "aaben").slice(0, 2);
  const maalere = ot?.sensors.filter((s) => m.wIds.includes(s.machineId)) ?? [];
  const hvad = log.filter((h) => h.hvor === m.kort).slice(0, 6);
  const sagt = samtale.filter((b) => b.tekst.includes(m.kort)).slice(0, 4);

  return (
    <section className={`hud-enhed t-${tilstand}`} aria-label={`Enhed ${m.kort}`}>
      <header className="he-head">
        <span className="hf-navn">{m.kort}</span>
        <span className="hf-id">W-{m.wIds.join(" · W-")}{m.lane ? ` · Spor ${m.lane}` : ""}</span>
        {sim && <Sim />}
        <span className="hf-tilstand">{tilstandTekst}</span>
        <button type="button" className="hp-knap" onClick={onLuk}>Luk</button>
      </header>

      <div className="he-grid">
        <div className="he-kol">
          <h3 className="he-h">Drift</h3>
          {m.kanaler.every((k) => k.value === null) ? <p className="hp-afventer"><span className="hp-afventer-mark" aria-hidden />Afventer signal</p> : (
            <div className="hf-kanaler he-kanaler">
              {m.kanaler.map((k) => {
                const g = graense(k.spec);
                return (
                  <div key={k.spec.id} className={`hf-kanal${k.alarm ? " is-alarm" : ""}`}>
                    <span className="hf-lbl">{k.spec.label}{g && <b className="hp-graense">{g}</b>}</span>
                    <span className="hf-tal"><Tal v={k.value} d={k.spec.decimaler} /><i>{k.spec.unit}</i></span>
                    <Kurve
                      serie={historik.get(`m:${m.id}:${k.spec.id}`) ?? []}
                      tone={k.alarm ? "brud" : "drift"}
                      hoejde={24}
                      graense={[k.spec.alarmHoej, k.spec.alarmLav].filter((x): x is number => x !== undefined)}
                    />
                  </div>
                );
              })}
            </div>
          )}
          {m.fyld !== null && (
            <div className="he-buffer">
              <span className="hf-lbl">Buffer foran</span>
              <span className="hf-tal"><Tal v={m.fyld} d={0} /><i>%</i></span>
              {/* Grænsen er der, hvor Driftsagenten stopper sporet — et styret
                  stop, ikke en fejl. Fejlen er maskinen efter. */}
              <Bjaelke v={m.fyld} max={100} graense={DRIFTSAGENT.bufferStopPct} alarm={m.fyld >= DRIFTSAGENT.bufferStopPct} styret />
            </div>
          )}
        </div>

        <div className="he-kol">
          {ind && (
            <>
              <h3 className="he-h">Indstilling</h3>
              <Haeldning m={m} tvaers={ind.tvaers} langs={ind.langs} />
              <dl className="he-ind">
                {([["tvaers", "Tværs", "°", 1], ["langs", "Langs", "°", 1], ["slag", "Slag", "/min", 0], ["luft", "Luft", "%", 0]] as const).map(([id, navn, enhed, d]) => {
                  const { maalt, flytter } = paaVej(m, id, ind[id]);
                  return (
                    <div key={id}>
                      <dt>{navn}</dt>
                      <dd>
                        <span className="fm-num">{tal(ind[id], d)}{enhed}</span>
                        {/* Er målingen ikke nået derhen endnu, står den ved siden af. */}
                        {flytter && <span className="he-paavej fm-num">målt {tal(maalt!, d)}</span>}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </>
          )}

          {analyse?.andele && (
            <>
              <h3 className="he-h">Klassificering {analyse.proeveT !== null && <span className="he-tid">{klok(analyse.proeveT)}</span>}</h3>
              <div className="he-klasser">
                {ANALYSE.klasser.map((k, i) => (
                  <span key={k} className={i === 3 && analyse.andele![3] > ANALYSE.alarmFV3 ? "is-alarm" : undefined}>
                    <b>{k}</b><Tal v={analyse.andele![i]} d={1} /><i>%</i>
                  </span>
                ))}
                {analyse.tung && (["bigf", "bigh", "nots"] as const).map((k) => (
                  <span key={k}><b>{k.toUpperCase()}</b><Tal v={analyse.tung![k]} d={1} /><i>%</i></span>
                ))}
                {analyse.udskudPct !== null && <span><b>Udskud</b><Tal v={analyse.udskudPct} d={1} /><i>%</i></span>}
              </div>
            </>
          )}

          {aaben && <AnbefalingKort a={aaben} onUdfoer={onUdfoer} onAfvis={onAfvis} />}
          {tidligere.map((a) => <AnbefalingKort key={a.id} a={a} />)}

          {maalere.length > 0 && (
            <>
              <h3 className="he-h">Målere</h3>
              <ul className="he-maalere">
                {maalere.map((s) => (
                  <li key={s.id}><span className="fm-num">{s.id}</span><span>{s.type}</span><span className="he-dim">{s.signal}</span></li>
                ))}
              </ul>
            </>
          )}

          {(hvad.length > 0 || sagt.length > 0) && (
            <>
              <h3 className="he-h">Seneste</h3>
              <ul className="he-seneste">
                {sagt.map((b) => (
                  <li key={`b${b.nr}`}><time>{klok(b.t)}</time><span className="he-fra">{b.fra}</span><span>{b.tekst}</span><span className="he-dim">{kildeTekst(b, false)}</span></li>
                ))}
                {hvad.map((h) => (
                  <li key={`h${h.t}${h.tekst}`} className={`n-${h.niveau}`}><time>{klok(h.t)}</time><span className="he-fra">{h.hvor}</span><span>{h.tekst}</span></li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Linjeagenternes anbefalinger til operatøren. De åbne øverst, med
 * knapperne; de seneste afgjorte under, med det, der faktisk skete.
 */
export function AnbefalingerPanel({ anbefalinger, sim, nr, still, onUdfoer, onAfvis }: {
  anbefalinger: Anbefaling[];
  sim: boolean;
  nr: number;
  still?: boolean;
  onUdfoer: (id: number) => void;
  onAfvis: (id: number) => void;
}) {
  return (
    <Panel label="Anbefalinger" nr={nr} still={still} right={sim ? <Sim /> : undefined}>
      <AnbefalingListe anbefalinger={anbefalinger} afgjorte={2} onUdfoer={onUdfoer} onAfvis={onAfvis} />
    </Panel>
  );
}

/**
 * De åbne med knapperne, og så mange afgjorte under, der er plads til. Samme
 * liste ved linjen og på kontoret: den, der trykker først, bestemmer.
 */
export function AnbefalingListe({ anbefalinger, afgjorte, onUdfoer, onAfvis }: {
  anbefalinger: Anbefaling[];
  afgjorte: number;
  onUdfoer?: (id: number) => void;
  onAfvis?: (id: number) => void;
}) {
  const aabne = anbefalinger.filter((a) => a.status === "aaben");
  const afgjort = anbefalinger.filter((a) => a.status !== "aaben").slice(0, Math.max(0, afgjorte - aabne.length));
  if (aabne.length === 0 && afgjort.length === 0) {
    return <p className="hp-afventer"><span className="hp-afventer-mark" aria-hidden />Ingen anbefalinger endnu</p>;
  }
  return (
    <div className="hp-anbefalinger">
      {aabne.map((a) => <AnbefalingKort key={a.id} a={a} onUdfoer={onUdfoer} onAfvis={onAfvis} />)}
      {afgjort.map((a) => <AnbefalingKort key={a.id} a={a} />)}
    </div>
  );
}

/**
 * En anbefaling, som operatøren ser den: hvad, hvorfor og hvad der ventes —
 * og, når den er åben, knapperne. AI'en anbefaler; et menneske beslutter.
 */
export function AnbefalingKort({ a, onUdfoer, onAfvis }: {
  a: Anbefaling;
  onUdfoer?: (id: number) => void;
  onAfvis?: (id: number) => void;
}) {
  const navn = a.parameter === "tvaers" ? "Tværs" : "Luft";
  const enhed = a.parameter === "tvaers" ? "°" : " %";
  const d = a.parameter === "tvaers" ? 1 : 0;
  const status = { aaben: "Anbefaling", udfoert: "Udført", afvist: "Afvist", udloebet: "Bortfaldet" }[a.status];
  return (
    <div className={`he-anbefaling s-${a.status}`}>
      <div className="he-anb-hoved">
        <span className="he-anb-status">{status}{a.af && ` · ${a.af}`}</span>
        <span className="he-fra">{a.fra}</span>
        <span className="he-tid">{klok(a.t)}</span>
      </div>
      <p className="he-anb-hvad"><b>{a.kort}</b> · {navn} {tal(a.fraVaerdi, d)} → {tal(a.tilVaerdi, d)}{enhed}</p>
      <p className="he-anb-forventet fm-num">
        Venter FV3 {a.forventet.fv3 >= 0 ? "+" : ""}{tal(a.forventet.fv3, 1)} · udskud {a.forventet.udskud >= 0 ? "+" : ""}{tal(a.forventet.udskud, 1)} pp
      </p>
      {a.efter && (
        <p className="he-anb-efter fm-num">
          Blev FV3 {tal(a.foer.fv3, 1)} → {tal(a.efter.fv3, 1)} % · udskud {tal(a.foer.udskud, 1)} → {tal(a.efter.udskud, 1)} %
        </p>
      )}
      {a.status === "aaben" && onUdfoer && onAfvis && (
        <div className="he-anb-knapper">
          <button type="button" className="hp-knap is-udfoer" onClick={() => onUdfoer(a.id)}>Udfør</button>
          <button type="button" className="hp-knap" onClick={() => onAfvis(a.id)}>Afvis</button>
        </div>
      )}
    </div>
  );
}

/**
 * Dækkets hældning, set fra enden og fra siden. Vinklen er overdrevet fire
 * gange, så en ændring på et par tiendedele kan ses; tallet står ved siden
 * af. Er målingen ikke nået hen, hvor den er sat, står det satte stiplet —
 * det, der ikke er der endnu.
 */
function Haeldning({ m, tvaers, langs }: { m: MaskinLaesning; tvaers: number; langs: number }) {
  const maalt = (id: string) => m.kanaler.find((k) => k.spec.id === id)?.value ?? null;
  const OVERDRIV = 4;
  const vis = (navn: string, id: string, sat: number) => {
    const { maalt: er, flytter } = paaVej(m, id, sat);
    const vinkel = (v: number) => (-v * OVERDRIV * Math.PI) / 180;
    const linje = (v: number) => {
      const a = vinkel(v);
      return { x1: 50 - Math.cos(a) * 38, y1: 26 - Math.sin(a) * 38, x2: 50 + Math.cos(a) * 38, y2: 26 + Math.sin(a) * 38 };
    };
    return (
      <figure className="he-vinkel">
        <svg viewBox="0 0 100 52" aria-hidden>
          <line x1={6} y1={26} x2={94} y2={26} className="he-vandret" />
          {flytter && <line {...linje(sat)} className="he-sat" />}
          <line {...linje(er ?? sat)} className="he-daek" />
          <circle cx={50} cy={26} r={2.4} className="he-akse" />
        </svg>
        <figcaption><span>{navn}</span><span className="fm-num">{tal(er ?? sat, 1)}°</span></figcaption>
      </figure>
    );
  };
  return (
    <div className="he-haeldning" role="img" aria-label={`Hældning tværs ${tal(maalt("tvaers") ?? tvaers, 1)} grader, langs ${tal(maalt("langs") ?? langs, 1)} grader`}>
      {vis("Tværs", "tvaers", tvaers)}
      {vis("Langs", "langs", langs)}
    </div>
  );
}

/**
 * Er målingen på vej et andet sted hen end det satte? Støjen er ikke en
 * bevægelse: først ud over tre gange kanalens eget udsving. Figuren og
 * tabellen spørger begge her, så de ikke kan svare forskelligt.
 */
function paaVej(m: MaskinLaesning, id: string, sat: number): { maalt: number | null; flytter: boolean } {
  const k = m.kanaler.find((x) => x.spec.id === id);
  const maalt = k?.value ?? null;
  if (!k || maalt === null) return { maalt, flytter: false };
  const oploesning = 10 ** -k.spec.decimaler;
  return { maalt, flytter: Math.abs(maalt - sat) > Math.max(3 * k.spec.spredning, oploesning) };
}
