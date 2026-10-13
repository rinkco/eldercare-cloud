export type Role = "admin" | "family";

export interface Session {
  token: string;
  role: Role;
  username: string;
  expiresAt: number;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  role: Role;
}

export interface UserOut {
  id: number;
  username: string;
  role: string;
  display_name: string | null;
  phone: string | null;
}

export interface AccessMember {
  id: number;
  user_id: number;
  username: string;
  display_name: string | null;
  relation: string | null;
}

/** 账号关联的老人（用户列表「监护关系」抽屉，仅 admin）。 */
export interface UserElder {
  elder_id: number;
  name: string;
  relation: string | null;
}

/** 可作为监护成员添加的候选家属账号（admin / 家属检索）。 */
export interface AccessCandidate {
  id: number;
  username: string;
  display_name: string | null;
}

export interface Elder {
  id: number;
  name: string;
  gender: string | null;
  birth_date: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  address: string | null;
  notes: string | null;
  created_at: string;
}

export interface ElderInput {
  name: string;
  gender?: string | null;
  birth_date?: string | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  address?: string | null;
  notes?: string | null;
}

export interface Contact {
  id: number;
  name: string;
  phone: string;
  relation: string | null;
  priority: number;
  is_primary: boolean;
}

export interface ContactInput {
  name: string;
  phone: string;
  relation?: string | null;
  priority: number;
  is_primary: boolean;
}

export interface Device {
  id: number;
  device_uid: string;
  kind: string;
  model: string | null;
  status: string;
  elder_id: number | null;
  battery_percent: number | null;
  last_seen_at: string | null;
  bound_at: string | null;
}

export interface Geofence {
  id: number;
  name: string;
  center_lat: number;
  center_lon: number;
  radius_m: number;
  enabled: boolean;
}

export interface GeofenceInput {
  name: string;
  center_lat: number;
  center_lon: number;
  radius_m: number;
  enabled: boolean;
}

export type MetricName = "heart_rate" | "spo2" | "steps" | "activity";

export interface Telemetry {
  id: number;
  device_id: number;
  elder_id: number;
  metric: string;
  value_num: number | null;
  value_text: string | null;
  lat: number | null;
  lon: number | null;
  meta_json: Record<string, unknown>;
  recorded_at: string;
}

export interface MetricStats {
  avg: number;
  min: number;
  max: number;
  count: number;
}

export interface ActivityCount {
  activity: string;
  count: number;
}

export interface TrendBucket {
  bucket_start: string;
  heart_rate: MetricStats | null;
  spo2: MetricStats | null;
  steps_total: number | null;
  activity: ActivityCount[];
}

export interface EventRecord {
  id: number;
  elder_id: number;
  device_id: number;
  type: string;
  severity: string;
  confidence: number | null;
  occurred_at: string;
  payload_json: Record<string, unknown>;
  meta_json: Record<string, unknown>;
  status: string;
}

export interface Alert {
  id: number;
  event_id: number;
  elder_id: number;
  status: string;
  created_at: string;
  handled_at: string | null;
  handled_by: number | null;
  event_type: string;
  severity: string;
}

export interface NotificationRecord {
  id: number;
  alert_id: number;
  contact_id: number | null;
  channel: string;
  target: string | null;
  content: string;
  status: string;
  sent_at: string | null;
  error: string | null;
}

export interface RealtimeAlert {
  id: number;
  event_id: number;
  elder_id: number;
  elder_name: string;
  event_type: string;
  severity: string;
  occurred_at: string;
  status: string;
}

export interface RealtimeTelemetry {
  elder_id: number;
  device_uid: string;
  metric: string;
  value_num: number | null;
  value_text: string | null;
  lat: number | null;
  lon: number | null;
  meta_json?: Record<string, unknown>;
  recorded_at: string;
}

export type RealtimeMessage =
  | { type: "ready" }
  | { type: "alert"; alert: RealtimeAlert }
  | { type: "telemetry"; telemetry: RealtimeTelemetry };
