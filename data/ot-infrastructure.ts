// OT-infrastrukturen: alt mellem IO-skabet og en database.
//
// Håndholdt fil, som resten af OT-dataene. Det meste står som "missing" — det
// findes ikke i dag. Det er ikke en mangel ved listen, men listens egentlige
// budskab: FT-756 kan måle nok så fint, men der er ingen vej fra måleren til
// en database, før de her ting er på plads.
//
// `requiredFor` peger på leddene i datavejen. Det er den binding, der farver
// trinnene under fanen Data, så man kan se præcis hvor kæden knækker.
import type { OtInfraNode } from "../src/lib/types";

const sliberi: OtInfraNode[] = [
  {
    id: "INF-UPLINK",
    type: "uplink",
    name: "Uplink RIO-SLIB-01 → OT-rack",
    location: "Sliberiet → kontorbygning",
    status: "missing",
    requiredFor: ["kobler", "edge", "mssql", "dashboard"],
    note: "Cat6 eller fiber. Afstanden er ikke målt — over 90 m skal det være fiber.",
  },
  {
    id: "INF-RACK",
    type: "rack",
    name: "OT Test Center",
    location: "Kontorbygning, mini rack",
    status: "missing",
    requiredFor: ["edge", "mssql", "dashboard"],
    note: "Core switch, router/firewall, edge-server og UPS.",
  },
  {
    id: "INF-VLAN",
    type: "vlan",
    name: 'VLAN "felt-IO"',
    location: "OT-nettet",
    status: "missing",
    requiredFor: ["kobler", "edge"],
    note: "Holder felt-IO adskilt fra kontornettet.",
  },
  {
    id: "INF-EDGE",
    type: "edge",
    name: "Edge-collector",
    location: "OT Test Center",
    status: "missing",
    requiredFor: ["edge", "mssql", "dashboard"],
    note: "Python. Poller Modbus TCP fra kobleren og skriver til MSSQL.",
  },
  {
    id: "INF-DMZ-LINK",
    type: "link",
    name: "Forbindelse OT → DMZ",
    location: "OT-rack → Azure",
    status: "missing",
    requiredFor: ["dashboard"],
    note: "Kun udgående. Der åbnes ikke ind mod OT-nettet.",
  },
  {
    id: "INF-DMZ",
    type: "cloud",
    name: "DMZ/VM i Azure",
    location: "Azure",
    status: "ordered",
    requiredFor: ["dashboard"],
    note: "Bestilt. Den eneste brik, der er sat i gang.",
  },
];

export const OT_INFRASTRUCTURE: Record<string, OtInfraNode[]> = { sliberi };
