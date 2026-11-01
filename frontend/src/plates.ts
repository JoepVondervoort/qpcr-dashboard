import type {Experiment,Run} from './types'

export const FILE_ACCEPT='.csv,.xlsx,.xlsm,.xls'
const ACCEPTED_FILE=/\.(csv|xlsx|xlsm|xls)$/i

export const isAcceptedFile=(name:string)=>ACCEPTED_FILE.test(name)
export const withoutExtension=(name:string)=>name.replace(ACCEPTED_FILE,'')
/** Plates of a combined run; empty for a run that is one plate. */
export const plateNames=(run:Pick<Run,'plates'>)=>run.plates?.map(plate=>plate.name)??[]
export function experimentFiles(experiment:Pick<Experiment,'original_filename'|'parsed_summary'>):string[] {
 return experiment.parsed_summary?.files?.length?experiment.parsed_summary.files:experiment.original_filename?[experiment.original_filename]:[]
}

/** "X_1.xls" and "X_3.xls" become "X_1 + 3", matching how the backend names a combined run. */
export function defaultLabel(fileNames:string[]):string {
 const names=fileNames.map(withoutExtension)
 if(names.length<2)return names[0]??''
 let prefix=names.reduce((common,name)=>{let i=0;while(i<common.length&&common[i]===name[i])i++;return common.slice(0,i)})
 while(prefix&&!/[_\- ]$/.test(prefix))prefix=prefix.slice(0,-1)
 return prefix&&names.every(name=>name.length>prefix.length)?[names[0],...names.slice(1).map(name=>name.slice(prefix.length))].join(' + '):names.join(' + ')
}
