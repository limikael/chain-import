import {arrayify} from "./js-util.js";
import {packageUp} from "package-up";
import {resolveAllExports} from 'resolve-import'
import resolvePackagePath from "resolve-package-path";
import fs, {promises as fsp} from "fs";
import path from "node:path";
import {DeclaredError} from "./js-util.js";

export default class ChainMeta {
	constructor({cwd, keyword, exportPath, conditions, extraModuleDirs, extraModules,
			defaultEnableKey, enableKey, disableKey}) {
		this.cwd=cwd;
		this.keyword=keyword;
		this.exportPath=exportPath;
		if (!this.exportPath.startsWith("."))
			this.exportPath="./"+this.exportPath;

		this.conditions=conditions;
		this.extraModuleDirs=arrayify(extraModuleDirs);
		this.extraModules=arrayify(extraModules);
		this.defaultEnableKey=defaultEnableKey;
		this.enableKey=enableKey;
		this.disableKey=disableKey;

		this.chainMeta=this;
	}

	getConf() {
		return ({
			cwd: this.cwd,
			keyword: this.keyword,
			exportPath: this.exportPath,
			conditions: this.conditions,
			extraModuleDirs: this.extraModuleDirs,
			extraModules: this.extraModules,
			defaultEnableKey: this.defaultEnableKey,
			enableKey: this.enableKey,
			disableKey: this.disableKey,
		});
	}

	async load() {
		this.pkgPath=await packageUp({cwd: this.cwd});
		if (path.dirname(this.pkgPath)!=path.resolve(this.cwd))
			throw new Error("No package.json found");

		this.pkg=JSON.parse(await fsp.readFile(this.pkgPath));
		this.moduleInfos=[];

		let deps=this.pkg.dependencies;
		if (!deps)
			deps={};

		for (let depName in deps) {
			let p=resolvePackagePath(depName,this.pkgPath);
			if (!p)
				throw new Error("cannot resolve: "+depName);

			await this.processPackagePath(p);
		}

		for (let parentDir of this.extraModuleDirs) {
			for (let dir of await fsp.readdir(parentDir)) {
				let p=path.join(parentDir,dir,"package.json");
				await this.processPackagePath(p);
			}
		}
	}

	async processPackagePath(depPackagePath) {
		let depPkg=JSON.parse(await fsp.readFile(depPackagePath));
		if (this.keyword) {
			if (!depPkg.keywords || !depPkg.keywords.includes(this.keyword))
				return;
		}

		let pathPackageName=path.basename(path.dirname(depPackagePath))
		if (pathPackageName!=depPkg.name)
			throw new Error("Unexpected module name / path: "+depPackagePath);

		if (depPkg.type!="module")
			throw new Error("Not a module: "+depPackagePath);

		let allExports=await resolveAllExports(depPackagePath,{conditions: this.conditions});
		if (!allExports[this.exportPath])
			return;

		this.moduleInfos.push({
			pkg: depPkg,
			name: depPkg.name,
			exportPathname: allExports[this.exportPath].pathname,
		});
	}

	async importModules() {
		this.assertClean();
		let mods=[];

		for (let moduleInfo of this.getModuleInfos({enabled: true}))
			mods.push(await import(moduleInfo.exportPathname));

		for (let mod of this.extraModules)
			mods.push(mod);

		return mods;
	}

	getModuleInfos({enabled, name}={}) {
		return this.moduleInfos.filter(moduleInfo=>{
			if (enabled!==undefined &&
					!this.isModuleEnabled(moduleInfo.name))
				return false;

			if (name && moduleInfo.name!=name)
				return false;

			return true;
		});
	}

	getModuleInfoByName(name) {
		let mods=this.getModuleInfos({name});
		if (!mods.length)
			throw new Error("Not installed: "+name);

		return mods[0];
	}

	isModuleEnabled(moduleName) {
		let moduleInfo=this.moduleInfos.find(m=>m.name==moduleName);
		if (!moduleInfo)
			return false;

		let enabled=true;
		if (this.defaultEnableKey &&
				moduleInfo.pkg.hasOwnProperty([this.defaultEnableKey]))
			enabled=moduleInfo.pkg[this.defaultEnableKey];

		if (this.disableKey && 
				arrayify(this.pkg[this.disableKey]).includes(moduleInfo.name))
			enabled=false;

		if (this.enableKey && 
				arrayify(this.pkg[this.enableKey]).includes(moduleInfo.name))
			enabled=true;

		return enabled;
	}

	isModuleDefaultEnabled(moduleName) {
		let moduleInfo=this.moduleInfos.find(m=>m.name==moduleName);
		if (!moduleInfo)
			return false;

		let enabled=true;
		if (this.defaultEnableKey &&
				moduleInfo.pkg.hasOwnProperty([this.defaultEnableKey]))
			enabled=moduleInfo.pkg[this.defaultEnableKey];

		return enabled;
	}


	isModuleInstalled(name) {
		let mods=this.getModuleInfos({name});
		//console.log(mods);
		return mods.length>0;
	}

	isModuleKnown(name) {
		return (this.isModuleInstalled(name) ||
			arrayify(this.pkg[this.enableKey]).includes(name) ||
			arrayify(this.pkg[this.disableKey]).includes(name))
	}

	async savePkgJson() {
		let content=JSON.stringify(this.pkg,null,2);
		await fsp.writeFile(this.pkgPath,content);
	}

	assertClean() {
		if (this.dirty)
			throw new Error("Chain metadata has been modified!");
	}

	markDirty() {
		this.dirty=true;
	}
}

export async function chainLoadMeta(options) {
	if (options.chainMeta)
		return options.chainMeta;

	//console.log("loading...");

	let chainMeta=new ChainMeta(options);
	await chainMeta.load();
	return chainMeta;
}

export async function chainImport(options) {
	let chainMeta=await chainLoadMeta(options);
	let mods=await chainMeta.importModules();
	let functionNames=[];

	for (let mod of mods)
		for (let k in mod)
			if (typeof mod[k]=="function")
				functionNames.push(k);

	let chain={chainMeta: chainMeta};
	for (let functionName of functionNames) {
		let fns=[];
		for (let mod of mods)
			if (typeof mod[functionName]=="function")
				fns.push(mod[functionName]);

		fns.sort((a,b)=>a.priority??10-b.priority??10);
		chain[functionName]=async function(...args) {
			chainMeta.assertClean();
			for (let fn of fns)
				await fn(...args);
		}
	}

	return chain;
}

async function chainSetEnable(chainConf, moduleName, enable) {
	let chainMeta=await chainLoadMeta(chainConf);

	if (!chainMeta.enableKey || !chainMeta.disableKey)
		throw new Error("Enable/disable not available");

	if (!chainMeta.isModuleKnown(moduleName))
		throw new DeclaredError("Unknown module: "+moduleName);

	let pkg=chainMeta.pkg;
	pkg[chainMeta.enableKey]=arrayify(pkg[chainMeta.enableKey]).filter(n=>n!=moduleName);
	pkg[chainMeta.disableKey]=arrayify(pkg[chainMeta.disableKey]).filter(n=>n!=moduleName);

	if (chainMeta.isModuleInstalled(moduleName)) {
		if (enable && !chainMeta.isModuleDefaultEnabled(moduleName))
			pkg[chainMeta.enableKey].push(moduleName);

		else if (!enable && chainMeta.isModuleDefaultEnabled(moduleName))
			pkg[chainMeta.disableKey].push(moduleName);
	}

	if (!pkg[chainMeta.enableKey].length)
		delete pkg[chainMeta.enableKey]

	if (!pkg[chainMeta.disableKey].length)
		delete pkg[chainMeta.disableKey]

	chainMeta.markDirty();
	await chainMeta.savePkgJson();
}

export async function chainEnable(chainConf, moduleName) {
	await chainSetEnable(chainConf,moduleName,true);
}

export async function chainDisable(chainConf, moduleName) {
	await chainSetEnable(chainConf,moduleName,false);
}

export async function chainList(chain, query={}) {
	let chainMeta=chain.chainMeta;
	let infos=chainMeta.getModuleInfos(query);

	return infos.map(info=>({
		name: info.name,
		description: info.pkg.description,
		enabled: chainMeta.isModuleEnabled(info.name),
	}));
}