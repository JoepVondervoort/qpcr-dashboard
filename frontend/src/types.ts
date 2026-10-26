import type { StatisticalResult } from './StatisticsPanel'

export type SampleMetadata = { condition: string; series: string; timepoint: number | null; time_unit: 'day' | 'hour'; replicate: string; biological_unit_id?: string; role?: 'biological'|'technical_control'|null }

export type ExperimentDesign = {time_origin: string; design_type: 'unknown'|'independent'|'paired'|'blocked'|'repeated'; experimental_unit: string; confirmed: boolean; reference_validation_note: string; efficiency_note: string}
export type QualityFlag = {id:string; kind:'control_signal'|'technical_spread'; run_id:string; sample:string; sample_instance_id:string; assay:string; message:string; range:number|null; status:'needs_review'|'reviewed'; review?:{reason:string;at:string}; measurements:(RawRecord & {excluded_reason?:string})[]}
export type Quality = {flags:QualityFlag[];unresolved_count:number;reviewed_count:number;spread_threshold:number;policy:string}
export type QualityChange = {decisions?:Record<string,{reason:string}>;measurement_exclusions?:Record<string,string>;spread_threshold?:number;note?:string}
export type RawRecord = {
  measurement_id?: string
  sample_instance_id?: string
  run_id: string
  run_name: string
  sample: string
  assay: string
  ct: number | null
  well: string
  status: string
  omit: boolean
  reporter?: string | null
  sheet: string
  row_number: number
}

export type Run = {
  id: string
  name: string
  sheet: string
  header_row: number
  record_count: number
  plate_size: number | null
}

export type SampleRow = {
  sample: string
  target_assay: string
  reference_assays: string[]
  target_ct_values: number[]
  target_ct_mean: number | null
  target_ct_sd: number | null
  reference_ct_values: Record<string, number[]>
  reference_ct_means: Record<string, number | null>
  reference_ct_mean: number | null
  delta_ct: number | null
  baseline_sample: string
  baseline_delta_ct: number
  delta_delta_ct: number | null
  fold_change: number | null
  log2fc: number | null
  result_status: string
}

export type AnalysisResult = {
  run_id: string
  target_assay: string
  reference_assays: string[]
  baseline_sample: string
  context_revision?: number
  profile_id?: string
  analysis_settings?: Record<string,unknown>
  sample_instances?: Record<string,SampleMetadata>
  excluded_measurements?: Record<string,string>
  experiment_design?: ExperimentDesign
  qc_summary?: {unresolved_count:number;reviewed_count:number;spread_threshold:number}
  method_version?: string
  technical_control_samples?: string[]
  technical_control_measurement_count?: number
  baseline_samples?: string[]
  sample_groups?: Record<string, string>
  excluded_samples?: string[]
  exclusion_reasons?: Record<string, string>
  hit_threshold?: number
  statistics?: StatisticalResult
  analysis_id?: string
  created_at?: string
  sample_metadata?: Record<string, SampleMetadata>
  batch_errors?: {target_assay: string; reason: string}[]
  reference_method: string
  excluded_measurement_count: number
  samples: SampleRow[]
}

export type Experiment = {
  id: string
  name: string
  status: string
  context_revision?: number
  sample_instances?: Record<string,SampleMetadata>
  experiment_design?: ExperimentDesign
  measurement_exclusions?: Record<string,string>
  quality?: Quality
  audit_events?: Record<string,unknown>[]
  original_filename?: string
  raw_records?: RawRecord[]
  sample_roles?: Record<string, string>
  sample_metadata?: Record<string, SampleMetadata>
  parsed_summary?: { record_count?: number; warnings?: string[]; runs?: Run[] }
  analysis_result?: AnalysisResult
}

export type Project = {
  id: string
  name: string
  experiments: Experiment[]
}


export type ExclusionPreview={current:SampleRow[];preview:AnalysisResult;saved:false;note:string}
