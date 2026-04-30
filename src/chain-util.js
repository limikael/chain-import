export function chainAttachCommanderCommand(chain, parentCommand, name) {
    let command=parentCommand.command(name);
    command.action(async (...args) => {
        let cmd=args.pop();
        let cmdOpts=args.pop();
        const globalOpts = cmd.parent.opts();
        const options = { ...globalOpts, ...cmdOpts, project, args };
        return await chain[name](options);
    });
    return command;
}
