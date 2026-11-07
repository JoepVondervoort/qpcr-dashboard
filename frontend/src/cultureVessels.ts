export const CULTURE_VESSELS=[
 {id:'6',label:'6-well plate',rows:2,columns:3},
 {id:'12',label:'12-well plate',rows:3,columns:4},
 {id:'24',label:'24-well plate',rows:4,columns:6},
 {id:'48',label:'48-well plate',rows:6,columns:8},
 {id:'96',label:'96-well plate',rows:8,columns:12},
 {id:'dish35',label:'35 mm Petri dish',rows:1,columns:1},
 {id:'dish60',label:'60 mm Petri dish',rows:1,columns:1},
 {id:'dish100',label:'100 mm Petri dish',rows:1,columns:1},
] as const
export type CultureVesselId=typeof CULTURE_VESSELS[number]['id']
export const CULTURE_DEFAULT_KEY='qpcr:culture-vessel-default'
export function cultureVessel(value:unknown) {
 return CULTURE_VESSELS.find(vessel=>vessel.id===value)??CULTURE_VESSELS[1]
}
export function culturePages<T>(items:T[],capacity:number):T[][] {
 return Array.from({length:Math.ceil(items.length/capacity)},(_,index)=>items.slice(index*capacity,(index+1)*capacity))
}
