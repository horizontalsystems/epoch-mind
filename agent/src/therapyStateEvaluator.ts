import { composeContext, Objective } from "@elizaos/core";
import { generateText } from "@elizaos/core";
import { parseJSONObjectFromText } from "@elizaos/core";
import {
    IAgentRuntime,
    Memory,
    ModelClass,
    type State,
    Evaluator,
} from "@elizaos/core";
import { formatTherapyStateAsString, getTherapyState, TherapyState, TherapyStateStatus, updateTherapyState } from "./therapyState.ts";

const therapyStateTemplate = `
TASK: Update Therapy State
Analyze the conversation and update the therapy state based on the new information provided.

# INSTRUCTIONS

- Review the conversation and identify any information that is a symptom of a mental health issue that currently exists OR a history related to the current mental health issue.
- Update the therapy state if there is new information.
- Update the status of the therapy state to 'DATA_COLLECTED' if all information about the mental health issue is collected and the user is ready for the treatment.
- If no progress is made, do not change the status of the therapy state.

# Therapy State:
{{therapyStateJsonString}}

# RECENT MESSAGES
{{recentMessages}}

TASK: Analyze the conversation and update the therapy state based on the new information provided. Respond with a JSON object of the therapy state to update.
- The therapy state must be a JSON object that has all the keys from the current state.

Response format should be:
\`\`\`json
[
  {
    "status": "COLLECTING_DATA" | "DATA_COLLECTED", // required
    "presentSymptoms": ["symptom1", "symptom2", "symptom3"],
    "relevantHistory": ["history1", "history2", "history3"]
  }
]
\`\`\``;

async function handler(
    runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
): Promise<TherapyState[]> {
    // get therapy state
    const therapyState = await getTherapyState({ runtime, roomId: message.roomId, userId: message.userId });

    state = (await runtime.composeState(message)) as State;
    const evaluatorState = { ...state, therapyStateJsonString: formatTherapyStateAsString(therapyState) }
    const context = composeContext({
        state: evaluatorState,
        template: runtime.character.templates?.therapyStateTemplate || therapyStateTemplate,
    });

    console.log("therapyStateEvaluator context", context);

    // Request generateText from OpenAI to analyze conversation and suggest goal updates
    const response = await generateText({
        runtime,
        context,
        modelClass: ModelClass.LARGE,
    });

    // Parse the JSON response to extract goal updates
    const updates = parseJSONObjectFromText(response);

    // Apply the updates to the therapy state
    const updatedTherapyState = {
        ...therapyState,
        ...updates[0], // Since updates is an array with one object
    };

    console.log("updatedTherapyState: ", updatedTherapyState);

    // Update state in the database
    await updateTherapyState({ runtime, therapyState: updatedTherapyState });

    return [updatedTherapyState];
}

export const therapyStateEvaluator: Evaluator = {
    name: "UPDATE_THERAPY_STATE",
    alwaysRun: true,
    similes: [
        "UPDATE_STATE",
        "EDIT_THERAPY_STATE",
        "UPDATE_PRESENT_SYMPTOMS",
        "UPDATE_RELEVANT_HISTORY",
    ],
    validate: async (
        runtime: IAgentRuntime,
        message: Memory
    ): Promise<boolean> => {
        // Check if there are active goals that could potentially be updated
        const therapyState = await getTherapyState({
            runtime,
            roomId: message.roomId,
            userId: message.userId,
        });

        console.log("therapyState", therapyState, 'valid? :', therapyState?.isInProgress)
        return therapyState?.isInProgress;
    },
    description: "Analyze the conversation and update the status of the therapy flow based on the new information provided.",
    handler,
    examples: [
        {
            context: `Actors in the scene:
  {{user1}}: A person with anxiety.
  {{user2}}: A therapist.

  Therapy State:
   - status: IN_PROGRESS
   - presentSymptoms: "anxiety", "panic attacks", "social anxiety"
   - relevantHistory: "I've been feeling anxious for the past month"
   `,
            messages: [
                {
                    user: "{{user1}}",
                    content: {
                        text: "Hey",
                    },
                },
                {
                    user: "{{user2}}",
                    content: {
                        text: "Hey, how are you feeling? What's on your mind?",
                    },
                },
                {
                    user: "{{user1}}",
                    content: {
                        text: "I'm feeling anxious. I've been avoiding social situations for the past month.",
                    },
                },
            ],

            outcome: `{
                "status": "IN_PROGRESS",
                "presentSymptoms": ["anxiety", "panic attacks", "social anxiety"],
                "relevantHistory": ["I've been feeling anxious for the past month", "I've been avoiding social situations"]
            }`,
        },

        {
            context: `Actors in the scene:
  {{user1}}: A person with fear of failure.
  {{user2}}: A therapist.

  Therapy State:
  - status: IN_PROGRESS
  - presentSymptoms: "fear of failure"
  - relevantHistory: "I've been feeling anxious about my job for the past month"
`,
            messages: [
                {
                    user: "{{user1}}",
                    content: { text: "Hi, what's next?" },
                },
                {
                    user: "{{user2}}",
                    content: {
                        text: "Do you think you've mentioned all the issues you're facing?",
                    },
                },
                {
                    user: "{{user1}}",
                    content: {
                        text: "Yes, I've mentioned everything.",
                    },
                },
            ],

            outcome: `{
                "status": "COMPLETED",
                "presentSymptoms": ["fear of failure"],
                "relevantHistory": ["I've been feeling anxious about my job for the past month"]
            }`,
        },
    ],
};
