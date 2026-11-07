import type {UploadMode} from './uploads'

const OPTIONS:{mode:UploadMode;title:string;detail:string}[]=[
 {mode:'experiments',title:'Separate experiments',detail:'One experiment per file, each named after its file. For unrelated exports, such as several days of runs.'},
 {mode:'runs',title:'One experiment, each plate its own run',detail:'Each plate is normalized to baseline samples on that plate.'},
 {mode:'combined',title:'One experiment, plates in one combined run',detail:'Plates share one baseline, for an experiment split over plates (for example day 0 on one plate, day 21 on another). Plates are compared directly, without inter-run calibration.'},
]

/** Several files are separate experiments or plates of one. The app cannot tell, so nothing is chosen in advance. */
export function UploadChoice({count,mode,onChange,disabled=false}:{count:number;mode:UploadMode|null;onChange:(mode:UploadMode)=>void;disabled?:boolean}) {
 return <fieldset className="plate-choice" disabled={disabled}><legend>How do these {count} files belong together?</legend>
  {OPTIONS.map(option=><label key={option.mode}><input type="radio" name="upload-mode" checked={mode===option.mode} onChange={()=>onChange(option.mode)}/><span><strong>{option.title}</strong><small>{option.detail}</small></span></label>)}
 </fieldset>
}
