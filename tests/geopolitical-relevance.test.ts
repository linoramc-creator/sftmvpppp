import test from 'node:test';
import assert from 'node:assert/strict';
import {isGeopolitical,isGeopoliticalTopic,geopoliticalNews} from '../supabase/functions/analyze-ticker/geopolitical-news.ts';
import {curateFeed} from '../supabase/functions/analyze-ticker/panels.ts';

const article=(title:string,excerpt='')=>({title,excerpt,date:new Date().toISOString().slice(0,10),publishedAt:new Date().toISOString(),url:'https://www.bbc.com/news/'+encodeURIComponent(title),source:'BBC'});

test('rejects actual general-interest stories from the production geopolitical feed',()=>{
 const rejected=[
  article('Tennis star Svitolina says emotional toll of Ukraine war led to Monfils separation','The two top tennis pros married in 2021 and have one child together.'),
  article('Ukraine says it carried out first drone airlift of wounded soldier from front line',"The serviceman was surrounded by landmines and enemy drones so a ground rescue was not possible, Ukraine's military says."),
  article('Saudi Arabia postpones big investor conference to 2027 as Iran-backed Houthis escalate attacks on kingdom','Militants have launched repeated volleys of missiles and drones since an airport attack.'),
  article('Trump says suspension of Russia sanctions is to keep peace negotiations going','The president blocked numerous sanctions two days before they were due to take effect.'),
 ];
 for(const row of rejected){assert.equal(isGeopoliticalTopic(row),true,row.title);assert.equal(isGeopolitical(row),false,row.title);}
 assert.deepEqual(geopoliticalNews(rejected),[]);
 assert.deepEqual(curateFeed(rejected),[],'Rejected political stories must not reappear in main headlines');
});

test('retains evidence of equity and sovereign fixed-income impact across publishers',()=>{
 const accepted=[
  article("'Cannot play hide and seek': Minister's warning over haze sends Singapore agricultural stocks lower",'The Singapore Exchange had questioned seven firms about possible links to the haze.'),
  article('EU tariffs aimed at China hitting Ukraine, steel boss says','New measures are curbing cheap imports.'),
  article('French government collapses as OAT-Bund spread widens'),
  article('UK budget announcement pushes gilt yields higher'),
  article('Las elecciones en Francia elevan la prima de riesgo y castigan los bonos soberanos'),
  article('El Gobierno anuncia nuevas medidas fiscales y cae la bolsa'),
  article('Ukraine ceasefire eases gas supply fears'),
  article('President imposes sanctions on Russian oil exports'),
  article('Container ship sinks in Strait of Hormuz as Iran steps up attacks'),
  article('Los ataques de Irán interrumpen el suministro de petróleo'),
 ];
 for(const row of accepted){assert.ok(isGeopolitical(row),row.title);assert.ok(isGeopolitical({...row,source:'CNBC',url:'https://www.cnbc.com/story'}),row.title);}
});

test('does not mistake physical stocks, shared images or military actions for securities',()=>{
 const rejected=[
  'US troops report lower ammunition stocks after military attacks',
  'Ukraine government shares photos of drone attacks as a lower rescue count is reported',
  'Rusia anuncia nuevos ataques y acciones militares con submarinos',
  'Ukraine war brings families together and strengthens family bonds',
  'President opens school in Ukraine as war continues',
  'War anniversary: history of oil markets',
 ];
 for(const title of rejected)assert.equal(isGeopolitical(article(title)),false,title);
});

test('keeps market-irrelevant politics out before limits and preserves ordinary financial headlines',()=>{
 const ordinary=article('ASML raises earnings guidance as shares rise');
 const rows=[article('Ukraine says drone rescued wounded soldier'),ordinary,article('EU announces new chip export controls to China')];
 assert.equal(isGeopoliticalTopic(ordinary),false);
 const main=curateFeed(rows.filter(a=>!isGeopoliticalTopic(a)));
 assert.deepEqual(main.map(a=>a.title),[ordinary.title]);
 assert.deepEqual(geopoliticalNews(rows).map(a=>a.title),['EU announces new chip export controls to China']);
});
