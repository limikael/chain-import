function normalizeTokens(tokens) {
    if (!tokens)
        tokens=[];

    let result = "procedural";
    let execution = "async";

    for (let t of tokens) {
        if (["procedural","collect","collect-flat","first-defined"].includes(t))
            result = t;

        if (["sync","async","async-parallel"].includes(t))
            execution = t;
    }

    return { result, execution };
}

export function callContractFunctions(tokens, fns, args) {
    const { result, execution } = normalizeTokens(tokens);

    if (result === "first-defined" && execution === "async-parallel") {
        throw new Error("Invalid contract: first-defined cannot be used with async-parallel");
    }

    // ---- SYNC ----
    if (execution === "sync") {
        let results = [];

        for (let fn of fns) {
            let r = fn(...args);

            if (r instanceof Promise)
                throw new Error("Function returned a Promise in sync mode");

            if (result === "first-defined") {
                if (r !== undefined) return r;
            }

            if (result === "collect") results.push(r);
            if (result === "collect-flat") {
                if (Array.isArray(r)) results.push(...r);
                else results.push(r);
            }
        }

        if (result === "collect" || result === "collect-flat") return results;
        return;
    }

    // ---- ASYNC (SEQUENTIAL) ----
    if (execution === "async") {
        return (async () => {
            let results = [];

            for (let fn of fns) {
                let r = await fn(...args);

                if (result === "first-defined") {
                    if (r !== undefined) return r;
                }

                if (result === "collect") results.push(r);
                if (result === "collect-flat") {
                    if (Array.isArray(r)) results.push(...r);
                    else results.push(r);
                }
            }

            if (result === "collect" || result === "collect-flat") return results;
        })();
    }

    // ---- ASYNC PARALLEL ----
    if (execution === "async-parallel") {
        return (async () => {
            const resultsRaw = await Promise.all(fns.map(fn => fn(...args)));

            if (result === "collect") return resultsRaw;

            if (result === "collect-flat") {
                let out = [];
                for (let r of resultsRaw) {
                    if (Array.isArray(r)) out.push(...r);
                    else out.push(r);
                }
                return out;
            }

            // procedural
            return;
        })();
    }
}