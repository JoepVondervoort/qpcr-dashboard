/** How several plates are analysed: each on its own, or as one run that shares a baseline. */
export function PlateChoice({combine,onChange,disabled=false,target}:{combine:boolean;onChange:(combine:boolean)=>void;disabled?:boolean;target?:string}) {
 return <fieldset className="plate-choice" disabled={disabled}><legend>Plates</legend>
  <label><input type="radio" name="plate-choice" checked={!combine} onChange={()=>onChange(false)}/><span><strong>Separate runs</strong><small>Each plate is normalized to baseline samples on that plate.</small></span></label>
  <label><input type="radio" name="plate-choice" checked={combine} onChange={()=>onChange(true)}/><span><strong>{target?`Add to ${target}`:'One combined run'}</strong><small>Plates share one baseline, for an experiment split over plates (for example day 0 on one plate, day 21 on another). Plates are compared directly, without inter-run calibration.</small></span></label>
 </fieldset>
}
