import type { StatisticalResult } from './StatisticsPanel'

export type SampleMetadata = { cell_line?: string|null; confluency?: string|null; condition: string; series: string; timepoint: number | null; time_unit: 'day' | 'hour'; replicate: string; biological_unit_id?: string; role?: 'biological'|'technical_control'|null }

export type ExperimentDesign = {time_origin: string; design_type: 'unknown'|'independent'|'paired'|'blocked'|'repeated'; experimental_unit: string; confirmed: boolean; reference_validation_note: string; efficiency_note: string}
export type QualityFlag = {id:string; kind:'control_signal'|'technical_spread'; run_id:string; plate?:string|null; sample:string; sample_instance_id:string; assay:string; message:string; range:number|null; status:'needs_review'|'reviewed'; review?:{reason:string;at:string}; measurements:(RawRecord & {excluded_reason?:string})[]}
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
  /** Instrument plate within a combined run. */
  plate?: string
  /** The export's own sample name, kept when the scientist renamed the well in the plate layout. */
  instrument_sample?: string
}

/** A plate-layout question only the scientist can answer; blocking ones stop the analysis of their run. */
export type LayoutCheck = {id:string; kind:'unnamed_wells'|'shared_name'|'split_across_plates'; run_id:string; plate:string|null; plates?:string[]; sample:string|null; wells:string[]; wells_per_assay?:number; blocking:boolean; message:string}
export type LayoutChange = {run_id:string; plate:string|null; wells?:Record<string,string>; confirm_replicates?:string[]; revoke_replicates?:string[]}
/** Wells the scientist confirmed as technical replicates of one sample; lapses when the name covers other wells. */
export type LayoutConfirmation = {run_id:string; plate:string|null; sample:string; wells:string[]}
/** Wells with only a late Ct, or without any Ct between samples: the scientist decides whether they are no-template controls or the sample whose place they hold. */
export type LateWells = {sample:string|null; wells:string[]; reason:'late'|'none'; cts:string}
/** The workbench's numbering for a plate whose export names no samples (or gives every well one name), with its doubts. */
export type LayoutSuggestion = {run_id:string; plate:string|null; kind:'unnamed'|'placeholder'; wells:Record<string,string>; samples:number; shape:[number,number]; numbering:'band'|'gene'; controls:string[]; unfitted:string[]; late:LateWells[]; summary:string; doubts:string[]; confident:boolean}
/** A numbering that was applied and whose numbers are still on the plate; late lists only the open questions. */
export type AutoLayout = Pick<LayoutSuggestion,'run_id'|'plate'|'kind'|'wells'|'samples'|'shape'|'numbering'|'summary'|'doubts'|'late'> & {at:string}

export type Run = {
  id: string
  name: string
  sheet: string
  header_row: number
  record_count: number
  plate_size: number | null
  source_file?: string
  /** The instrument's own file name (.eds), without its folder. */
  instrument_file?: string | null
  /** Present when several plates were combined into this run. */
  plates?: {name:string;sheet:string;header_row:number;record_count:number;plate_size:number|null;source_file?:string}[]
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
  target_wells?: WellCount
  reference_wells?: Record<string, WellCount>
}

export type WellCount = {detected: number; total: number}
export type DetectionNote = WellCount & {sample: string; assay: string; role: 'target'|'reference'}

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
  /** The baseline actually used; a later time point when the target was not detected at the chosen one. */
  effective_baseline_samples?: string[]
  baseline_note?: string | null
  detection_notes?: DetectionNote[]
  sample_groups?: Record<string, string>
  excluded_samples?: string[]
  exclusion_reasons?: Record<string, string>
  hit_threshold?: number
  statistics?: StatisticalResult
  analysis_id?: string
  batch_id?: string
  created_at?: string
  sample_metadata?: Record<string, SampleMetadata>
  batch_errors?: {target_assay: string; reason: string}[]
  reference_method: string
  excluded_measurement_count: number
  samples: SampleRow[]
}

/** One condition of one saved target/run analysis, as summarized by the library endpoint. */
export type GeneResult = {assay:string;run_id:string;run_name:string;condition:string;series:string;timepoint:number|null;time_unit:'day'|'hour';is_baseline:boolean;fold_change:number|null;n:number;out_of_date:boolean}

export type AnalysisType = 'expression'|'reference_stability'
/** What the experiment measures. Expression until the scientist answers; a suggestion explains why the app asks. */
export type AnalysisTypeState = {type:AnalysisType; confirmed:boolean; stability_genes:string[]|null; suggestion:{type:AnalysisType;reasons:string[]}|null}

export type LibrarySummary = {analysis_type?:AnalysisType;analysis_type_question?:boolean;assay_count:number;biological_sample_count:number;unresolved_count:number;unresolved_findings?:number;layout_issue_count?:number;reviewed_count:number;design_confirmed:boolean;analysis_state:"needs_recalculation"|"partial"|"saved"|"not_calculated";saved_result_count:number;outdated_result_count:number;gene_results?:GeneResult[]}

export type Experiment = {
  created_at?: string
  library_summary?: LibrarySummary
  id: string
  name: string
  status: string
  context_revision?: number
  sample_instances?: Record<string,SampleMetadata>
  /** Suggestions read from unusual sample names that the scientist has not confirmed yet. */
  name_checks?: Record<string,string>
  /** Names ending in a number that may count replicates: the annotation if the scientist says so, and any other guess in the name. */
  replicate_questions?: Record<string,{annotation:SampleMetadata;note:string|null}>
  analysis_type?: AnalysisTypeState
  experiment_design?: ExperimentDesign
  measurement_exclusions?: Record<string,string>
  quality?: Quality
  layout_checks?: LayoutCheck[]
  layout_confirmations?: LayoutConfirmation[]
  layout_suggestions?: LayoutSuggestion[]
  auto_layouts?: AutoLayout[]
  /** Why numbering on import failed, and how to import the plates so that it works. */
  numbering_problem?: string | null
  audit_events?: Record<string,unknown>[]
  original_filename?: string
  raw_records?: RawRecord[]
  sample_roles?: Record<string, string>
  sample_metadata?: Record<string, SampleMetadata>
  parsed_summary?: { record_count?: number; warnings?: string[]; runs?: Run[]; files?: string[] }
  analysis_result?: AnalysisResult
}

export type Project = {
  id: string
  name: string
  experiments: Experiment[]
}


export type ExclusionPreview={current:SampleRow[];preview:AnalysisResult;saved:false;note:string}
