export class PortfolioError extends Error{status:number;constructor(message:string,status=400){super(message);this.name='PortfolioError';this.status=status;}}
type Body=Record<string,any>;
const object=(v:unknown):v is Body=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const bounded=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const clean=(v:unknown,min:number,max:number)=>typeof v==='string'&&v.trim().length>=min&&v.length<=max&&!/[<>\p{Cc}\p{Cf}]/u.test(v);
const text=(v:unknown,min:number,max:number)=>typeof v==='string'&&v.trim().length>=min&&v.length<=max&&!/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\p{Cf}]/u.test(v);
export const portfolioSymbol=(v:unknown):v is string=>typeof v==='string'&&/^[A-Z][A-Z0-9.-]{0,14}$/.test(v);
const keys=(v:Body,allowed:string[])=>Object.keys(v).every(k=>allowed.includes(k));
const fail=():never=>{throw new PortfolioError('Solicitud del simulador inválida.');};
/** A client can only submit commands. Quotes, balances, execution prices,
 * ownership and accounting state are supplied exclusively by the server. */
export function validatePortfolioRequest(body:Body):void{
 if(!object(body)||body.panel!=='portfolioLab'||typeof body.action!=='string')fail();
 const common=['panel','action','portfolioId','requestId'];
 if(body.action==='list'){if(!keys(body,['panel','action']))fail();return;}
 if(body.action==='create'){if(!keys(body,['panel','action','name','initialCash','requestId'])||!clean(body.name,1,60)||!bounded(body.initialCash,100,10000000)||!uuid(body.requestId))fail();return;}
 if(!uuid(body.portfolioId))fail();
 if(body.action==='snapshot'||body.action==='risk'){if(!keys(body,['panel','action','portfolioId']))fail();return;}
 if(body.action==='quote'){if(!keys(body,['panel','action','portfolioId','symbol'])||!portfolioSymbol(body.symbol))fail();return;}
 if(!uuid(body.requestId))fail();
 if(body.action==='rename'){if(!keys(body,[...common,'name'])||!clean(body.name,1,60))fail();return;}
 if(body.action==='order'){
  const o=body.order;if(!keys(body,[...common,'order'])||!object(o)||!keys(o,['symbol','side','type','quantity','limitPrice','stopPrice','timeInForce','extendedHours','note'])||!portfolioSymbol(o.symbol)||!['buy','sell','short','cover'].includes(o.side)||!['market','limit','stop','stop-limit'].includes(o.type)||!bounded(o.quantity,.000001,1000000)||Math.abs(Math.round(o.quantity*1e6)/1e6-o.quantity)>1e-10||!['day','gtc'].includes(o.timeInForce)||typeof o.extendedHours!=='boolean'||o.note!==undefined&&!text(o.note,0,1000))fail();
  if(['limit','stop-limit'].includes(o.type)?!bounded(o.limitPrice,.000001,10000000):o.limitPrice!==undefined)fail();
  if(['stop','stop-limit'].includes(o.type)?!bounded(o.stopPrice,.000001,10000000):o.stopPrice!==undefined)fail();
  if(o.extendedHours&&!['limit','stop-limit'].includes(o.type))throw new PortfolioError('Para premarket y postmarket utiliza una orden limitada o stop-limit.');
  return;
 }
 if(body.action==='cancel'){if(!keys(body,[...common,'orderId'])||!uuid(body.orderId))fail();return;}
 if(body.action==='cash'){if(!keys(body,[...common,'kind','amount'])||!['deposit','withdrawal'].includes(body.kind)||!bounded(body.amount,.01,10000000))fail();return;}
 if(body.action==='settings'){if(!keys(body,[...common,'feePerOrder','slippageBps'])||!bounded(body.feePerOrder,0,100)||!bounded(body.slippageBps,0,100))fail();return;}
 if(body.action==='archive'){if(!keys(body,[...common,'archived'])||typeof body.archived!=='boolean')fail();return;}
 if(body.action==='journal'){if(!keys(body,[...common,'note'])||!text(body.note,1,1000))fail();return;}
 fail();
}
