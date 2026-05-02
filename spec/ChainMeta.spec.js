import {chainLoadMeta, chainImport, chainEnable, chainDisable, chainSetContract} from "../src/exports-node.js";
import {dirnameFromImportMeta} from "../src/node-util.js";
import path from "node:path";
import fs, {promises as fsp} from "node:fs";

let __dirname=dirnameFromImportMeta(import.meta);

async function initTestProject() {
	fs.rmSync(path.join(__dirname,"testproject"),{force: true, recursive: true});
	fs.cpSync(path.join(__dirname,"testproject.keep"),path.join(__dirname,"testproject"),{recursive: true});
	fs.renameSync(path.join(__dirname,"testproject/node_modules.keep"),path.join(__dirname,"testproject/node_modules"));
}

describe("ChainMeta",()=>{
	it("refactor",async ()=>{
		await initTestProject();

		let chainMeta=await chainLoadMeta({
			cwd: path.join(__dirname,"testproject"),
			keyword: "sys-plugin",
			exportPath: "hello",
			defaultEnableKey: "defaultEn",
			workspaceKey: "packages"
		});

		//console.log(chainMeta.getModuleInfos());
	});

	it("can load meta",async ()=>{
		await initTestProject();

		let chainMeta=await chainLoadMeta({
			cwd: path.join(__dirname,"testproject"),
			conditions: ["peac"],
			keyword: "sys-plugin",
			exportPath: "hello",
			workspaceKey: "packages",
			defaultEnableKey: "defaultEn",
			enableKey: "enablePlugins",
			disableKey: "disablePlugins",
		});

		expect(chainMeta.pkg.name).toEqual("testproject");
		expect(chainMeta.getModuleInfos().length).toEqual(3);
		expect(chainMeta.moduleInfos[1].exportPathname).toContain("hello-peac.js");
		expect(chainMeta.getModuleInfos({name: "someplugin"}).length).toEqual(1);
		expect(chainMeta.getModuleInfos({name: "undef"}).length).toEqual(0);

		expect(chainMeta.isModuleEnabled("undef")).toEqual(false);
		expect(chainMeta.isModuleEnabled("someplugin")).toEqual(true);
		expect(chainMeta.getModuleInfos({enabled: true}).length).toEqual(2);

		let enabled=chainMeta.getModuleInfos({enabled: true});
		expect(enabled[1].name).toEqual("someplugin");

		expect((await chainLoadMeta(chainMeta)).getModuleInfos().length).toEqual(3);
	});

	it("can import",async ()=>{
		await initTestProject();

		let chain=await chainImport({
			cwd: path.join(__dirname,"testproject"),
			conditions: ["peac"],
			keyword: "sys-plugin",
			exportPath: "hello",
			workspaceKey: "packages",
			defaultEnableKey: "defaultEn",
			enableKey: "enablePlugins",
			disableKey: "disablePlugins",
		});

		let ev={messages: []};
		await chain.build(ev);
		expect(ev.messages.length).toEqual(1);
		expect(ev.messages).toContain("hello-peac here");

		await chainEnable(chain,"plugin2");
		//console.log(chain.chainMeta.pkg);

		chain=await chainImport(chain.chainMeta.getConf());

		let infos=chain.chainMeta.getModuleInfos().map(m=>({
			name: m.name, 
			enabled: chain.chainMeta.isModuleEnabled(m.name)
		}));
		//console.log(infos);

		let ev2={messages: []};
		await chain.build(ev2);
		expect(ev2.messages.length).toEqual(2);

		await chainDisable(chain,"plugin2");
		chain=await chainImport(chain.chainMeta.getConf());
		let ev3={messages: []};
		await chain.build(ev3);
		expect(ev3.messages.length).toEqual(1);

		await chainDisable(chain,"someplugin");
		chain=await chainImport(chain.chainMeta.getConf());
		expect(chain.build).toBeUndefined();
	});

	it("can call with contract",async ()=>{
		await initTestProject();

		let chain=await chainImport({
			cwd: path.join(__dirname,"testproject"),
			conditions: ["peac"],
			keyword: "sys-plugin",
			exportPath: "hello",
			workspaceKey: "packages",
			defaultEnableKey: "defaultEn",
			enableKey: "enablePlugins",
			disableKey: "disablePlugins",
		});

		let ev={messages: []};
		await chain.build(ev);
		expect(ev.messages.length).toEqual(1);
		expect(ev.messages).toContain("hello-peac here");

		await chainEnable(chain,"plugin2");
		//console.log(chain.chainMeta.pkg);

		chain=await chainImport(chain.chainMeta.getConf());

		chainSetContract(chain,"doFirst","first-defined");
		chainSetContract(chain,"doCollect","collect");
		chainSetContract(chain,"doCollectSync",["collect","sync"]);
		chainSetContract(chain,"doesntExist","first-defined");

		expect(await chain.doFirst()).toEqual("test");
		expect(await chain.doCollect()).toEqual(["one","two"]);

		expect(chain.doCollectSync()).toEqual(["once","twice"]);
		expect(chain.doesntExist()).toEqual(undefined);
	});
});