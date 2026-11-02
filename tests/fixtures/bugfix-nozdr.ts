// Generated from bugfix-nozdr.json (the raw capture); regenerate, do not hand-edit.
export const bugfixNozdr = {
	status: 200,
	body: {
		model: "typesafe/jev-1.14-20261014",
		answers: {
			task_type: {
				type: "choice",
				choice: "bug_fix",
				probabilities: {
					bug_fix: 0.97,
					feature: 0,
					refactor: 0,
					question: 0,
					review: 0,
					ops: 0,
					follow_up: 0.03,
					other: 0,
				},
				confidence: 0.97,
			},
			goal: {
				type: "score",
				score: 2.88,
				legend: {
					"0": "No wanted result is stated.",
					"1": "The wanted result can only be guessed from hints.",
					"2": "A result is stated but can be read two ways.",
					"3": "One outcome is stated, open to only one reading.",
				},
				probabilities: {
					"0": 0,
					"1": 0,
					"2": 0.11,
					"3": 0.89,
				},
				confidence: 0.89,
			},
			context: {
				type: "score",
				score: 2.99,
				legend: {
					"0": "Claude would have to ask or search blindly.",
					"1": "Only a broad area is named, no file, symbol or error.",
					"2": "Some needed files, symbols or errors are named, not all.",
					"3": "The files, symbols or error are named or already known.",
				},
				probabilities: {
					"0": 0,
					"1": 0,
					"2": 0.01,
					"3": 0.99,
				},
				confidence: 0.99,
			},
			verification: {
				type: "score",
				score: 2,
				legend: {
					"0": "Nothing says how the result is checked.",
					"1": "A check is implied, e.g. 'make it work again'.",
					"2": "A check is stated: a test, expected output or acceptance condition.",
				},
				probabilities: {
					"0": 0,
					"1": 0,
					"2": 1,
				},
				confidence: 1,
			},
			constraints: {
				type: "score",
				score: 1.9,
				legend: {
					"0": "Scope matters and nothing limits what may change.",
					"1": "Some limits are given; where to stop is open.",
					"2": "Limits and non-goals are clear, or the request needs none.",
				},
				probabilities: {
					"0": 0,
					"1": 0.1,
					"2": 0.9,
				},
				confidence: 0.85,
			},
			evidence: {
				type: "score",
				score: 2,
				legend: {
					"0": "No observed behaviour is described.",
					"1": "The problem is named vaguely, e.g. 'it's broken'.",
					"2": "Error text, a repro or observed vs expected is given.",
				},
				probabilities: {
					"0": 0,
					"1": 0,
					"2": 1,
				},
				confidence: 1,
			},
			focus: {
				type: "score",
				score: 1.88,
				legend: {
					"0": "Several unrelated requests at once.",
					"1": "Related requests sprawling over many changes.",
					"2": "One coherent piece of work.",
				},
				probabilities: {
					"0": 0.05,
					"1": 0.02,
					"2": 0.93,
				},
				confidence: 0.82,
			},
			rationale: {
				type: "score",
				score: 1.71,
				legend: {
					"0": "The reason would change the answer and none is given.",
					"1": "The reason is only hinted at.",
					"2": "The reason is given, or the answer does not depend on it.",
				},
				probabilities: {
					"0": 0.11,
					"1": 0.08,
					"2": 0.81,
				},
				confidence: 0.55,
			},
			output: {
				type: "score",
				score: 1.79,
				legend: {
					"0": "The form matters and nothing says what it is.",
					"1": "Some of the form is given, e.g. code vs plan; the rest is open.",
					"2": "The form is clear (length, format, file, code or plan) or any will do.",
				},
				probabilities: {
					"0": 0,
					"1": 0.2,
					"2": 0.8,
				},
				confidence: 0.7,
			},
			reply_fit: {
				type: "score",
				score: 1.19,
				legend: {
					"0": "Unclear what in the last reply it refers to.",
					"1": "It probably refers to one part of the last reply; another reading fits.",
					"2": "It plainly answers or steers one part of the last reply.",
				},
				probabilities: {
					"0": 0.34,
					"1": 0.13,
					"2": 0.53,
				},
				confidence: 0,
			},
		},
		usage: {
			input_tokens: 1512,
			output_tokens: 201,
			cost: 6.3504e-5,
		},
		id: "gen-dec-1793620257-BsKporN1Zjz7KUMQVXwi",
		provider: "TypeSafe",
	},
};
