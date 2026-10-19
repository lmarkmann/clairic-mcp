// Stand-in for the workerd module, so tools run under vitest: AI.run is whatever a test installs.
type Run = (model: string, inputs: Record<string, unknown>) => Promise<unknown>;

let run: Run = () => Promise.reject(new Error("no AI.run stub installed"));

export function stubAiRun(next: Run) {
	run = next;
}

export const env = {
	AI: { run: (model: string, inputs: Record<string, unknown>) => run(model, inputs) },
	ACCESS_TEAM_DOMAIN: "",
	ACCESS_AUD: "",
};

export function waitUntil(promise: Promise<unknown>) {
	void promise;
}
