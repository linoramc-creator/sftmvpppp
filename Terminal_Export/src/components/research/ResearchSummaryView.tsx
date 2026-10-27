import {parseSections,renderElements} from './ReportMarkdown';
import ResearchMarkdown from './ResearchMarkdown';

export default function ResearchSummaryView({text}:{text:string}){
 const sections=Object.entries(parseSections(text,[],{preserveMetricTable:true}));
 if(sections.length<2)return <ResearchMarkdown text={text}/>;
 return <div aria-label="Claves resumidas del informe" className="report-content grid items-start gap-3 sm:grid-cols-2 [&_li]:!mb-2 [&_li]:!text-xs [&_li_span]:!text-xs [&_p]:text-xs [&_p]:leading-relaxed [&_table]:!text-xs [&_td]:!text-slate-300 [&_strong]:!text-slate-200">
  {sections.map(([title,nodes],index)=><section key={title} className={`min-w-0 rounded-lg border border-slate-700/60 bg-[#0b131f] p-4 ${index===0?'sm:col-span-2':''}`}><h3 className="mb-3 text-xs font-semibold text-blue-200">{title==='Section'?'En síntesis':title}</h3>{renderElements(nodes)}</section>)}
 </div>;
}
