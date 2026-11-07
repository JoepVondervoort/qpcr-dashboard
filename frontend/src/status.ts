export type StatusLevel='action'|'review'|'info'
export type StatusItem={id:'layout'|'stale'|'qc'|'names'|'design'|'draft'|'confounded'|'roles';level:StatusLevel;text:string}
export type DashboardStatus={level:StatusLevel|'ok';headline:string;leadId?:StatusItem['id'];items:StatusItem[]}
export type StatusInput={staleCount:number;resultCount:number;qcFindings:number;nameChecks?:number;designConfirmed:boolean;draftDirty:boolean;confounded:boolean;mixedRoles:string[];layout?:{blocking:number;unnamedWells:number}}

const rank:Record<StatusLevel,number>={action:0,review:1,info:2}
const plural=(count:number,word:string)=>`${count} ${word}${count===1?'':'s'}`

/** Single source of truth for what the dashboard asks the scientist to do, most urgent first. */
export function dashboardStatus(input:StatusInput):DashboardStatus {
 const layout=input.layout??{blocking:0,unnamedWells:0}
 const candidates:(StatusItem|false)[]=[
  layout.blocking>0&&{id:'layout',level:'action',text:`Plate layout needed: ${plural(layout.blocking,'sample name')} cover${layout.blocking===1?'s':''} more wells than one sample's replicates`},
  !layout.blocking&&layout.unnamedWells>0&&{id:'layout',level:'review',text:`${plural(layout.unnamedWells,'well')} with a gene but no sample name are left out of the analysis`},
  input.staleCount>0&&{id:'stale',level:'action',text:input.staleCount>=input.resultCount?'Results are out of date: samples, design or QC changed after they were calculated.':`${input.staleCount} of ${input.resultCount} results are out of date.`},
  input.qcFindings>0&&{id:'qc',level:'review',text:`${plural(input.qcFindings,'QC finding')} to review`},
  (input.nameChecks??0)>0&&{id:'names',level:'review',text:`${plural(input.nameChecks!,'sample name')} need${input.nameChecks===1?'s':''} a check: time points, conditions or replicate numbers`},
  !input.designConfirmed&&{id:'design',level:'review',text:'Study design not confirmed, so results are provisional'},
  input.draftDirty&&{id:'draft',level:'info',text:'Unsaved setup changes'},
  input.confounded&&{id:'confounded',level:'info',text:'Conditions were measured on separate runs; differences may include run effects'},
  input.mixedRoles.length>0&&{id:'roles',level:'info',text:`Assay roles differ between runs: ${input.mixedRoles.join(', ')}`},
 ]
 const items=candidates.filter((item):item is StatusItem=>Boolean(item)).sort((a,b)=>rank[a.level]-rank[b.level])
 if(!items.length)return {level:'ok',headline:'Nothing needs review',items:[]}
 return {level:items[0].level,headline:items[0].text,leadId:items[0].id,items:items.slice(1)}
}
