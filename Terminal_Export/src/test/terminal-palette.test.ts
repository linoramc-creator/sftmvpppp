/// <reference types="node" />
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import postcss,{type Rule} from 'postcss';
import {expect,it} from 'vitest';

it('isolates the quieter workspace colors from the feed and leaves financial status colors untouched',()=>{
 const css=postcss.parse(readFileSync(path.resolve('src/index.css'),'utf8')),workspaceRules:Rule[]=[];
 css.walkRules(rule=>{if(rule.selector.includes('data-terminal-palette'))workspaceRules.push(rule);});
 expect(workspaceRules.length).toBeGreaterThan(0);
 for(const rule of workspaceRules){
  expect(rule.selector.trim().startsWith('[data-terminal-palette="neutral"]')).toBe(true);
  expect(rule.selector).not.toMatch(/feed|svg|recharts|canvas/);
  rule.walkDecls(declaration=>{
   expect(declaration.prop).not.toMatch(/^--(?:primary|destructive|background|foreground)$/);
   expect(declaration.prop).not.toMatch(/filter|stroke|fill/);
   expect(declaration.important).toBeFalsy();
  });
 }
 css.walkDecls(/^--terminal-/,declaration=>{expect((declaration.parent as Rule).selector).toBe('[data-terminal-palette="neutral"]');});
 const financialColors=new Map<string,string>();css.walkRules(':root',rule=>{rule.walkDecls(declaration=>{financialColors.set(declaration.prop,declaration.value);});});
 expect(financialColors.get('--primary')).toBe('145 85% 42%');expect(financialColors.get('--destructive')).toBe('0 72% 55%');
});

it('compiles existing blue utilities with their exact original fallbacks outside the scoped workspace',async()=>{
 const require=createRequire(path.resolve('package.json')),tailwind=require('tailwindcss'),loadConfig=require('tailwindcss/loadConfig');
 const config=loadConfig(path.resolve('tailwind.config.ts'));
 const result=await postcss([tailwind({...config,content:[{raw:'<div class="text-blue-300 bg-blue-400 border-blue-500/40 text-primary text-destructive"></div>',extension:'html'}]})]).process('@tailwind utilities;',{from:undefined});
 const colorByClass=new Map<string,string>();result.root.walkRules(rule=>{rule.walkDecls(declaration=>{if(['color','background-color','border-color'].includes(declaration.prop))colorByClass.set(rule.selector,declaration.value);});});
 expect(colorByClass.get('.text-blue-300')).toContain('var(--terminal-blue-300, 147 197 253)');
 expect(colorByClass.get('.bg-blue-400')).toContain('var(--terminal-blue-400, 96 165 250)');
 expect(colorByClass.get('.border-blue-500\\/40')).toBe('rgb(var(--terminal-blue-500, 59 130 246) / 0.4)');
 expect(colorByClass.get('.text-primary')).toContain('var(--primary)');expect(colorByClass.get('.text-destructive')).toContain('var(--destructive)');
});
