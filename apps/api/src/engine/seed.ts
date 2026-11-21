import type { Hospital, IncidentType, Unit, UnitKind } from '@corridor/core';
import type { Graph } from './network';

interface UnitSeed {
  id: string;
  callSign: string;
  kind: UnitKind;
  home: string;
  plate: string;
}

const UNITS: UnitSeed[] = [
  { id: 'AMB-101', callSign: 'AMB 101', kind: 'ambulance', home: 'J11', plate: 'MH12EA1010' },
  { id: 'AMB-102', callSign: 'AMB 102', kind: 'ambulance', home: 'J11', plate: 'MH12EA1020' },
  { id: 'AMB-201', callSign: 'AMB 201', kind: 'ambulance', home: 'J14', plate: 'MH12EA2010' },
  { id: 'AMB-301', callSign: 'AMB 301', kind: 'ambulance', home: 'J22', plate: 'MH12EA3010' },
  { id: 'AMB-401', callSign: 'AMB 401', kind: 'ambulance', home: 'J30', plate: 'MH12EA4010' },
  { id: 'AMB-501', callSign: 'AMB 501', kind: 'ambulance', home: 'J05', plate: 'MH12EA5010' },
  { id: 'FIRE-11', callSign: 'ENGINE 11', kind: 'fire', home: 'J02', plate: 'MH12FB1100' },
  { id: 'FIRE-12', callSign: 'ENGINE 12', kind: 'fire', home: 'J02', plate: 'MH12FB1200' },
  { id: 'FIRE-21', callSign: 'ENGINE 21', kind: 'fire', home: 'J25', plate: 'MH12FB2100' },
  { id: 'FIRE-31', callSign: 'ENGINE 31', kind: 'fire', home: 'J33', plate: 'MH12FB3100' },
  { id: 'POL-41', callSign: 'PATROL 41', kind: 'police', home: 'J04', plate: 'MH12PL4100' },
  { id: 'POL-42', callSign: 'PATROL 42', kind: 'police', home: 'J21', plate: 'MH12PL4200' },
  { id: 'POL-43', callSign: 'PATROL 43', kind: 'police', home: 'J35', plate: 'MH12PL4300' },
  { id: 'POL-44', callSign: 'PATROL 44', kind: 'police', home: 'J13', plate: 'MH12PL4400' },
];

/** Registered fleet plates used by ANPR/vehicle authentication. */
export const FLEET_REGISTRY = new Set(UNITS.map((u) => u.plate));

export function seedUnits(graph: Graph, now: number): Unit[] {
  return UNITS.map((seed) => {
    const home = graph.node(seed.home);
    return {
      id: seed.id,
      callSign: seed.callSign,
      kind: seed.kind,
      plate: seed.plate,
      status: 'available',
      homeNodeId: seed.home,
      position: { x: home.x, y: home.y },
      heading: 0,
      speed: 0,
      route: [],
      plannedPath: [],
      destinationNodeId: null,
      incidentId: null,
      hospitalId: null,
      etaSeconds: null,
      baselineEtaSeconds: null,
      waitSeconds: 0,
      priorityScore: 0,
      verified: true,
      lastGpsAt: now,
      distanceTravelled: 0,
    };
  });
}

const HOSPITALS: {
  id: string;
  name: string;
  nodeId: string;
  specialties: IncidentType[];
  icu: [number, number];
  er: [number, number];
}[] = [
  {
    id: 'H1',
    name: 'City General Hospital',
    nodeId: 'J11',
    specialties: ['trauma', 'road_accident', 'medical', 'cardiac'],
    icu: [40, 30],
    er: [32, 19],
  },
  {
    id: 'H2',
    name: 'Sahyadri Cardiac Institute',
    nodeId: 'J14',
    specialties: ['cardiac', 'stroke', 'medical'],
    icu: [24, 17],
    er: [16, 9],
  },
  {
    id: 'H3',
    name: 'Ruby Trauma & Burns Centre',
    nodeId: 'J22',
    specialties: ['trauma', 'road_accident', 'fire', 'hazmat'],
    icu: [28, 22],
    er: [24, 15],
  },
  {
    id: 'H4',
    name: 'District Civil Hospital',
    nodeId: 'J30',
    specialties: ['medical', 'trauma', 'road_accident', 'stroke'],
    icu: [36, 29],
    er: [40, 27],
  },
];

export function seedHospitals(graph: Graph): Hospital[] {
  return HOSPITALS.map((h) => {
    const node = graph.node(h.nodeId);
    return {
      id: h.id,
      name: h.name,
      nodeId: h.nodeId,
      position: { x: node.x, y: node.y },
      specialties: h.specialties,
      icu: { total: h.icu[0], occupied: h.icu[1], reserved: 0 },
      emergency: { total: h.er[0], occupied: h.er[1], reserved: 0 },
      incoming: [],
      status: 'normal',
    };
  });
}

export const CALLER_NAMES = [
  'Ramesh Patil',
  'Sunita Deshmukh',
  'Arjun Mehta',
  'Fatima Shaikh',
  'Vikram Joshi',
  'Priya Kulkarni',
  'Imran Khan',
  'Neha Gupta',
  'Suresh Pawar',
  'Anita Rao',
  'Rahul Verma',
  'Kavita Nair',
];

export const INCIDENT_MIX: [IncidentType, number][] = [
  ['road_accident', 26],
  ['cardiac', 16],
  ['medical', 18],
  ['trauma', 10],
  ['stroke', 8],
  ['fire', 10],
  ['crime', 9],
  ['hazmat', 3],
];

export const INCIDENT_NOTES: Record<IncidentType, string[]> = {
  cardiac: ['Patient unresponsive, CPR in progress by bystander.', 'Elderly male, severe chest pain, sweating.'],
  stroke: ['Facial droop and slurred speech noticed 10 min ago.', 'Sudden weakness on left side.'],
  trauma: ['Fall from scaffolding, suspected spinal injury.', 'Stab wound, heavy bleeding.'],
  road_accident: [
    'Two-wheeler vs. bus, rider injured.',
    'Multi-car pile-up, lane blocked.',
    'Auto-rickshaw overturned, two injured.',
  ],
  fire: ['Smoke from 3rd floor of residential building.', 'Shop fire spreading to adjacent units.'],
  hazmat: ['Chemical tanker leak, strong odour reported.', 'Gas cylinder leak in market area.'],
  crime: ['Chain snatching, suspect fleeing on bike.', 'Violent altercation outside bar.'],
  medical: ['Diabetic patient collapsed.', 'Severe asthma attack, child.', 'Pregnant woman in labour, complications.'],
};
