// Facturación desde la base (FastAPI /api/v1/finance). Sin FLEETMAP_DATABASE_URL la API responde 503.
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(BASE + '/api/v1/finance' + path, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { detail?: string } | null;
    throw new Error(body?.detail ?? `La API respondió ${res.status}`);
  }
  return res.json() as Promise<T>;
}
const range = (from: string, to: string) => `?from=${from}&to=${to}`;

export interface Month { period: string; real: number | null; budget: number | null; real_hours: number | null; assets: number | null; sales: number | null; cost: number | null; cost_budget: number | null }
export interface Group { group_name: string; real: number | null; budget: number | null; hours: number | null; assets: number }
export interface Project { project_id: string; name: string | null; group_name: string | null; real: number; hours: number | null; assets: number }
export interface Family { family_code: string; name: string; real: number | null; budget: number | null; real_hours: number | null; budget_hours: number | null; real_budgeted: number | null }
export interface Asset {
  code: string; equipment_id: string; description: string | null; plate: string | null; family_code: string | null; family: string | null;
  rate_hour: number | null; rate_changes: number; real: number | null; hours: number | null; last_period: string | null; last_group: string | null;
  end_of_use: string | null; net_book_value: number | null;
}
export interface AssetDetail {
  code: string; equipment_id: string; description: string | null; plate: string | null; rate_hour: number | null;
  rates: { valid_from: string; rate_hour: number }[];
  months: { period: string; kind: 'real' | 'presupuesto'; hours: number | null; amount: number; groups: string | null }[];
}
export interface Cut {
  number: number; period_from: string; period_to: string; status: string; qty_billed: number | null; qty_validated: number | null;
  unit_price: number | null; amount: number | null; trips: number | null; m3: number | null; km_min: number | null; km_max: number | null;
  m3km_billed: number | null; m3km_calc: number | null; m3km_diff: number | null; tickets_with_diff: number | null;
  minimum: number | null; executed: number | null; shortfall: number | null; days: number | null;
}
export interface Contract {
  id: string; order_no: string | null; client: string; contractor: string; object: string | null; start_date: string | null; end_date: string | null; value: number | null;
  tariffs: { item_code: string; description: string; unit: string; unit_price: number; qty: number | null; source: string; in_force: boolean; valid_from: string }[];
  cuts: Cut[];
  standby: { cut_number: number; slot: string; plates: string[]; days_available: number; minimum_m3km: number; executed_m3km: number; trips: number; shortfall_m3km: number }[];
}

export const financeApi = {
  months: () => get<Month[]>('/months'),
  groups: (from: string, to: string) => get<Group[]>('/groups' + range(from, to)),
  projects: (from: string, to: string, group?: string) => get<Project[]>('/projects' + range(from, to) + (group ? `&group=${encodeURIComponent(group)}` : '')),
  families: (from: string, to: string) => get<Family[]>('/families' + range(from, to)),
  assets: (from: string, to: string) => get<Asset[]>('/assets' + range(from, to)),
  asset: (code: string) => get<AssetDetail>('/assets/' + encodeURIComponent(code)),
  contracts: () => get<Contract[]>('/contracts'),
};
