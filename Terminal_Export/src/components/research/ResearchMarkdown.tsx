import {parseSections,renderElements} from './ReportMarkdown';
export default function ResearchMarkdown({text}:{text:string}){
 const sections=parseSections(text,[],{preserveMetricTable:true});
 return <div className="report-content space-y-6 text-sm leading-relaxed text-slate-300 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-slate-100 [&_h4]:text-xs [&_p]:mb-3 [&_li]:!text-sm [&_table]:!text-xs [&_td]:!text-slate-300 [&_th]:!text-slate-400">{Object.entries(sections).map(([title,nodes])=><section key={title}>{title!=='Section'&&<h3 className="mb-3 border-b border-slate-800 pb-2 text-sm font-semibold text-slate-100">{title}</h3>}{renderElements(nodes)}</section>)}</div>;
}
