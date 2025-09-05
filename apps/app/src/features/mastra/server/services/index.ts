import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { createTool } from '@mastra/core/tools';
import {
  createStep, createWorkflow,
} from '@mastra/core/workflows';
import { streamText, generateText } from 'ai';
import { z } from 'zod';


const fileSearch = (prompt: string) => {
  const result = streamText({
    model: openai('gpt-4o'),
    prompt,
    tools: {
      file_search: openai.tools.fileSearch({
        vectorStoreIds: ['vs_68b964a09b848191ba2dbee3bf360234'],
        maxNumResults: 10,
        ranking: {
          ranker: 'auto',
        },
      }),
    },

    providerOptions: {
      openai: {
        store: true,
      },
    },
    // Force file search tool:
    toolChoice: { type: 'tool', toolName: 'file_search' },
  });
  return result;
};

const generatePreMessageStep = createStep({
  id: 'generate-pre-message-step',
  inputSchema: z.object({
    prompt: z.string(),
  }),
  outputSchema: z.object({
    value: z.string(),
  }),
  execute: async({ inputData, writer }) => {
    const { prompt } = inputData;

    const result = streamText({
      model: openai('gpt-4.1-nano'),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
          ],
        },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Generate a brief confirmation message based on the user\'s message' },
          ],
        },
      ],
    });

    for await (const text of result.textStream) {
      await writer.write({
        type: 'pre-message-event',
        text,
      });
    }

    return {
      value: prompt,
    };
  },
});

const fileSearchStep = createStep({
  id: 'file-search-step-step',
  inputSchema: z.object({
    prompt: z.string(),
  }),
  outputSchema: z.object({
    value: z.string(),
  }),
  execute: async({ inputData, writer }) => {
    const { prompt } = inputData;

    const fileSearchResult = fileSearch(prompt);

    for await (const text of fileSearchResult.textStream) {
      await writer.write({
        type: 'file-search-event',
        text,
      });
    }

    return {
      value: prompt,
    };
  },
});

const fileSearchWorkflow = createWorkflow({
  id: 'sequential-workflow',
  inputSchema: z.object({
    prompt: z.string().describe('Prompt entered by user'),
  }),
  outputSchema: z.object({
    value: z.string().describe('FileSearch results'),
  }),
})
  .parallel([generatePreMessageStep, fileSearchStep])
  .commit();


const fileSearchTool = createTool({
  id: 'file-search-tool',
  description: "Get results based on user prompts using OpenAI's fileSearch'",
  inputSchema: z.object({
    prompt: z.string().describe('user prompt'),
  }),
  outputSchema: z.object({
    output: z.any().describe('file search results'),
  }),

  execute: async({ context, writer }) => {
    const { prompt } = context;

    const result = fileSearch(prompt);

    for await (const text of result.textStream) {
      await writer.write({
        type: 'file-search-event',
        text,
      });
    }

    return { length: prompt.length };
  },
});


const growiAgent = new Agent({
  name: 'GROWI agent',
  instructions: `
    You are an Agent that performs GROWI operations based on prompts from users. Currently, the only supported tool is 'file-search-tool'.
  `,
  model: openai('gpt-4o'),
  tools: { fileSearchTool },
});

const growiAgentStep = createStep({
  id: 'growi-agent-step',
  inputSchema: z.object({
    prompt: z.string(),
  }),
  outputSchema: z.object({
    value: z.string(),
  }),
  execute: async({ inputData, writer }) => {
    const { prompt } = inputData;

    const agent = mastra.getAgent('growiAgent');
    const stream = await agent.streamVNext(prompt);

    for await (const chunk of stream.fullStream) {
      if (chunk?.payload?.output?.type === 'growi-agent-event' || chunk?.payload?.output?.type === 'file-search-event') {
        console.log(chunk.payload.output.text);
      }
    }

    return {
      value: prompt,
    };
  },
});

const growiAgentWorkflow = createWorkflow({
  id: 'growi-agent-workflow',
  inputSchema: z.object({
    prompt: z.string().describe('Prompt for the GROWI agent'),
  }),
  outputSchema: z.object({
    value: z.string().describe('Response from the GROWI agent'),
  }),
})
  .parallel([generatePreMessageStep, growiAgentStep])
  .commit();


export const mastra = new Mastra({
  agents: { growiAgent },
  workflows: {
    fileSearchWorkflow,
    growiAgentWorkflow,
  },
});


// export const fileSearchTool = createTool({
//   id: 'file-search-tool',
//   description: "Get results based on user prompts using OpenAI's fileSearch'",
//   inputSchema: z.object({
//     prompt: z.string().describe('user prompt'),
//   }),
//   outputSchema: z.object({
//     output: z.any().describe('file search results'),
//   }),

//   execute: async({ context, writer }) => {
//     console.log('context: ', context);

//     // const result = await generateText({
//     //     model: openai('gpt-4o'),
//     //   prompt: context.prompt,
//     //   tools: {
//     //     file_search: openai.tools.fileSearch({
//     //       // optional configuration:
//     //       vectorStoreIds: ['vs_68b65ccb682c81918368df3c0093e5ec'],
//     //       maxNumResults: 10,
//     //       ranking: {
//     //         ranker: 'auto',
//     //       },
//     //     }),
//     //   },

//     //   providerOptions: {
//     //     openai: {
//     //       store: true,
//     //     },
//     //   },
//     //   // Force file search tool:
//     //   toolChoice: { type: 'tool', toolName: 'file_search' },
//     // })


//     const result = streamText({
//       model: openai('gpt-4o'),
//       prompt: context.prompt,
//       tools: {
//         file_search: openai.tools.fileSearch({
//           // optional configuration:
//           vectorStoreIds: ['vs_68b65ccb682c81918368df3c0093e5ec'],
//           maxNumResults: 10,
//           ranking: {
//             ranker: 'auto',
//           },
//         }),
//       },

//       providerOptions: {
//         openai: {
//           store: true,
//         },
//       },
//       // Force file search tool:
//       toolChoice: { type: 'tool', toolName: 'file_search' },
//     });


//     for await (const text of result.textStream) {
//       await writer.write({
//         type: 'file-search-event',
//         text,
//       });
//     }

//     return {
//       output: result.text,
//     };
//   },
// });

// const fileSearchAgent = new Agent({
//   name: 'GROWI RAG Agent',
//   instructions: `
//     You are a helpful assistant for GROWI, a knowledge base software.
//     Your primary function is to answer questions based on the content of GROWI pages.
//   `,
//   model: openai('gpt-4o'),
//   tools: { fileSearchTool },
// });


// /**
//  *
//  *  Playground
//  *
//  */
// const weatherTool = createTool({
//   id: 'get-weather',
//   description: 'Get current weather for a location',
//   inputSchema: z.object({
//     location: z.string().describe('City name'),
//   }),
//   outputSchema: z.object({
//     output: z.string(),
//   }),
//   execute: async({ context }) => {
//     console.log('context: ', context);
//     return {
//       output: 'The weather is sunny',
//     };
//   },
// });


// const todoTool = createTool({
//   id: 'get-todo',
//   description: 'Get current todo items',
//   inputSchema: z.object({
//     userId: z.string().describe('User ID'),
//   }),
//   outputSchema: z.object({
//     output: z.array(z.string()),
//   }),
//   execute: async({ context }) => {
//     console.log('context: ', context);
//     return {
//       output: ['Buy groceries', 'Walk the dog'],
//     };
//   },
// });

// export const chatAgent = new Agent({
//   name: 'Chat Agent',
//   instructions: `
//     You are an excellent assistant. Answer user questions and use tools as needed to retrieve information. The tools currently supported are "get-weather" and "get-todo".

//     When responding:
//     If asked about the weather, use the "get-weather" tool to retrieve the current weather information.
//     If asked about a TODO list, use the "get-todo" tool to retrieve the current TODO items.
// `,
//   model: openai('gpt-4o-mini'),
//   tools: { weatherTool, todoTool },
// });

// export const mastra = new Mastra({
//   agents: { chatAgent, fileSearchAgent },
// });
