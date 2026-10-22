import {expect,it} from 'vitest';
import {extractSectorActivityPeers} from '../lib/sector-peers';
it('accepts Spanish and English comparison headers without importing the sector chart component',()=>{
 for(const [company,ticker] of [['Company','Symbol'],['Compañía','Símbolo'],['Nombre','Ticker']]){
  const report=`## Empresas Líderes\n| ${company} | ${ticker} |\n| --- | --- |\n| SAP SE | SAP.DE |\n| ASML Holding | ASML.AS |\n## Mejores ETFs\n| Company | Symbol |\n| Otro Fondo | FUND |`;
  expect(extractSectorActivityPeers(report)).toEqual([{symbol:'SAP.DE',name:'SAP SE'},{symbol:'ASML.AS',name:'ASML Holding'}]);
 }
});
it('preserves identity validation and deduplication with alternate header names',()=>{
 const report='## Empresas Líderes\n| Nombre | Símbolo |\n| --- | --- |\n| SAP SE | SAP.DE |\n| Duplicate | SAP.DE |\n| <script>bad</script> | BAD |\n| Invalid | ../private |';
 expect(extractSectorActivityPeers(report)).toEqual([{symbol:'SAP.DE',name:'SAP SE'}]);
});
