export function build(ev) {
	ev.messages.push("plugin2 here");
}

doFirst.priority=5;
export async function doFirst() {
	//console.log("test1");
	return "test";
}

doCollect.priority=5;
export async function doCollect() {
	return "one"
}

doCollectSync.priority=5;
export function doCollectSync() {
	return "once"
}