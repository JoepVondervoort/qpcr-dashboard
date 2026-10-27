/** Figure styling shared by screen display and every export; sizes are SVG user units. */
export const FIGURE_THEMES=['screen','journal'] as const
export type FigureThemeName=typeof FIGURE_THEMES[number]
export type FigureTheme={
 name:FigureThemeName;label:string;font:string
 text:{tick:number;axisTitle:number;legend:number;title:number;subtitle:number;footer:number}
 ink:string;muted:string;axis:string;axisWidth:number;gridColor:string;grid:boolean;yAxisLine:boolean;tickDirection:'out'|'none'
 baseline:{color:string;width:number;dash:string}
}

// A single-column export maps 360 units to 85 mm, so 12 units is just over 8 pt.
const THEMES:Record<FigureThemeName,FigureTheme>={
 screen:{name:'screen',label:'Screen',font:"'Inter Variable', Inter, 'Helvetica Neue', Arial, 'Liberation Sans', sans-serif",
  text:{tick:12,axisTitle:13,legend:12,title:16,subtitle:12,footer:12},
  ink:'#1f3238',muted:'#5b6e74',axis:'#9aa8ad',axisWidth:1,gridColor:'#edf0f1',grid:true,yAxisLine:false,tickDirection:'none',
  baseline:{color:'#8d9ca1',width:1,dash:'4 3'}},
 journal:{name:'journal',label:'Journal',font:"Arial, Helvetica, 'Liberation Sans', sans-serif",
  text:{tick:12,axisTitle:12,legend:12,title:13,subtitle:12,footer:12},
  ink:'#111111',muted:'#333333',axis:'#222222',axisWidth:.75,gridColor:'#e6e6e6',grid:false,yAxisLine:true,tickDirection:'out',
  baseline:{color:'#555555',width:.75,dash:'3 2'}},
}

/** Exports name fonts every recipient has: web fonts are neither embedded nor available when SVG is rendered to PNG. */
export const EXPORT_FONT="Arial, Helvetica, 'Liberation Sans', sans-serif"

export function figureTheme(name:string):FigureTheme {return THEMES[(FIGURE_THEMES as readonly string[]).includes(name)?name as FigureThemeName:'screen']}
