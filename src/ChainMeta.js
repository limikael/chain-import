import {arrayify} from "./js-util.js";
import {packageUp} from "package-up";
import {resolveAllExports} from 'resolve-import'
import resolvePackagePath from "resolve-package-path";
import fs, {promises as fsp} from "fs";
import path from "node:path";
import {DeclaredError} from "./js-util.js";
import {callContractFunctions, createDummyFunction} from "./function-contract.js";

export default class ChainMeta {
	constructor({cwd, roots, keyword, exportPath, conditions, workspaceKey,
			defaultEnableKey, enableKey, disableKey, internalKey, internal,
			contracts}) {
		this.pkgDir=cwd;
		this.roots=arrayify(roots);
		this.keyword=keyword;
		this.exportPath=exportPath;
		if (!this.exportPath.startsWith("."))
			this.exportPath="./"+this.exportPath;

		this.conditions=conditions;
		this.defaultEnableKey=defaultEnableKey;
		this.enableKey=enableKey;
		this.disableKey=disableKey;
		this.workspaceKey=workspaceKey;
		this.internal=arrayify(internal);
		this.internalKey=internalKey;
		this.contracts=contracts??{};

		this.chainMeta=this;
		this.moduleInfos=[];
		this.moduleInfosByName={};
	}

	cwd() {
		return this.pkgDir;
	}

	getConf() {
		return ({
			cwd: this.cwd(),
			roots: this.roots,
			keyword: this.keyword,
			exportPath: this.exportPath,
			conditions: this.conditions,
			defaultEnableKey: this.defaultEnableKey,
			enableKey: this.enableKey,
			disableKey: this.disableKey,
			workspaceKey: this.workspaceKey,
			internal: this.internal,
			internalKey: this.internalKey,
			contracts: this.contracts,
		});
	}

	async load() {
		if (this.cwd()) {
			let pkgJsonPath=path.join(this.cwd(),"package.json");
			this.pkg=JSON.parse(await fsp.readFile(pkgJsonPath));
			await this.processPackagePath(this.cwd(),true);
		}

		for (let root of this.roots)
			await this.processPackagePath(root,true);
	}

	async processPackagePath(pkgPath, root) {
		let pkgJsonPath=path.join(pkgPath,"package.json");
		let pkg=JSON.parse(await fsp.readFile(pkgJsonPath));
		if (!root &&
				this.keyword &&
				!arrayify(pkg.keywords).includes(this.keyword))
			return;

		if (path.basename(pkgPath)!=pkg.name)
			throw new Error("Unexpected module name / path: "+pkgPath);

		if (this.moduleInfosByName[pkg.name]) {
			if (this.moduleInfosByName[pkg.name].version!=pkg.version)
				throw new Error(
					"Conflicting plugin versions: "+pkg.name+": "+
					pkg.version+" / "+this.moduleInfosByName[pkg.name].version
				);
			return;
		}

		if (pkg.type!="module")
			throw new Error("Not a module: "+pkgPath);

		let allExports=await resolveAllExports(pkgJsonPath,{conditions: this.conditions});
		if (allExports[this.exportPath]) {
			let moduleInfo={
				name: pkg.name,
				version: pkg.version,
				description: pkg.description,
				exportPathname: allExports[this.exportPath].pathname,
				defaultEnabled: true,
				internal: false
			};

			if (this.defaultEnableKey &&
					pkg.hasOwnProperty(this.defaultEnableKey))
				moduleInfo.defaultEnabled=pkg[this.defaultEnableKey];

			if (this.internalKey)
				moduleInfo.internal||=Boolean(pkg[this.internalKey]);

			if (this.internal.includes(pkg.name) || root)
				moduleInfo.internal=true;

			if (moduleInfo.internal && !moduleInfo.defaultEnabled)
				throw new Error("Internal plugins can't be disabled by default.");

			this.moduleInfos.push(moduleInfo);
			this.moduleInfosByName[pkg.name]=moduleInfo;
		}

		let deps=pkg.dependencies??{};
		for (let depName in deps) {
			let p=resolvePackagePath(depName,pkgPath);
			if (!p)
				throw new Error("cannot resolve: "+depName);

			await this.processPackagePath(path.dirname(p));
		}

		if (this.workspaceKey && pkg[this.workspaceKey]) {
			let workspaces=arrayify(pkg[this.workspaceKey]);
			for (let workspace of workspaces) {
				for (let dir of await fsp.readdir(path.join(pkgPath,workspace))) {
					let p=path.join(pkgPath,workspace,dir);
					await this.processPackagePath(p);
				}
			}
		}
	}

	async importModules() {
		this.assertClean();
		let mods=[];

		for (let moduleInfo of this.getModuleInfos({enabled: true}))
			mods.push(await import(moduleInfo.exportPathname));

		return mods;
	}

	getModuleInfos({enabled, name, internal}={}) {
		return this.moduleInfos.filter(moduleInfo=>{
			if (enabled!==undefined &&
					!this.isModuleEnabled(moduleInfo.name))
				return false;

			if (name && moduleInfo.name!=name)
				return false;

			if (internal!==undefined && moduleInfo.internal!=internal)
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

		let enabled=moduleInfo.defaultEnabled;

		if (this.disableKey && 
				this.pkg &&
				arrayify(this.pkg[this.disableKey]).includes(moduleInfo.name))
			enabled=false;

		if (this.enableKey && 
				this.pkg &&
				arrayify(this.pkg[this.enableKey]).includes(moduleInfo.name))
			enabled=true;

		return enabled;
	}

	isModuleDefaultEnabled(moduleName) {
		let moduleInfo=this.moduleInfosByName[moduleName];
		if (!moduleInfo)
			return false;

		return moduleInfo.defaultEnabled;
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
		await fsp.writeFile(path.join(this.cwd(),"package.json"),content);
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
	let functionNames=new Set();

	for (let mod of mods)
		for (let k in mod)
			if (typeof mod[k]=="function")
				functionNames.add(k);

	functionNames = [...functionNames];
	let chain={chainMeta: chainMeta, cwd: ()=>chainMeta.cwd()};
	for (let functionName of functionNames) {
		let fns=[];
		for (let mod of mods)
			if (typeof mod[functionName]=="function")
				fns.push(mod[functionName]);

		fns.sort((a,b)=>(a.priority??10)-(b.priority??10));
		//console.log(fns);
		chain[functionName]=function(...args) {
			chainMeta.assertClean();
			let tokens=chainMeta.contracts[functionName];
			return callContractFunctions(tokens, fns, args)
		}
	}

	for (let k in chainMeta.contracts)
		if (!chain[k])
			chain[k]=createDummyFunction(chainMeta.contracts[k]);

	return chain;
}

async function chainSetEnable(chainConf, moduleName, enable) {
	let chainMeta=await chainLoadMeta(chainConf);

	if (!chainMeta.enableKey || !chainMeta.disableKey || !chainMeta.pkg)
		throw new Error("Enable/disable not available");

	if (!chainMeta.isModuleKnown(moduleName))
		throw new DeclaredError("Unknown module: "+moduleName);

	let pkg=chainMeta.pkg;
	pkg[chainMeta.enableKey]=arrayify(pkg[chainMeta.enableKey]).filter(n=>n!=moduleName);
	pkg[chainMeta.disableKey]=arrayify(pkg[chainMeta.disableKey]).filter(n=>n!=moduleName);

	if (chainMeta.isModuleInstalled(moduleName)) {
		if (enable && !chainMeta.isModuleDefaultEnabled(moduleName))
			pkg[chainMeta.enableKey].push(moduleName);

		else if (!enable && chainMeta.isModuleDefaultEnabled(moduleName)) {
			if (chainMeta.getModuleInfoByName(moduleName).internal)
				throw new DeclaredError("Internal plugin, can't disable: "+moduleName);

			pkg[chainMeta.disableKey].push(moduleName);
		}
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
		description: info.description,
		enabled: chainMeta.isModuleEnabled(info.name),
	}));
}

export function chainSetContract(chain, functionName, ...tokens) {
	tokens=tokens.flat(Infinity);
	chain.chainMeta.contracts[functionName]=tokens;

	if (!(chain instanceof ChainMeta)) {
		let chainMeta=chain.chainMeta;
		for (let k in chainMeta.contracts)
			if (!chain[k])
				chain[k]=createDummyFunction(chainMeta.contracts[k]);
	}
}