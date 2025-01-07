import { assign, createActor, setup } from "xstate";
import { speechstate } from "speechstate";
import { createBrowserInspector } from "@statelyai/inspect";
import { KEY, NLU_KEY } from "./azure.js";

const inspector = createBrowserInspector();

const azureCredentials = {
  endpoint: "https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
  key: KEY,
};

const azureLanguageCredentials = { 
  endpoint: "https://260026.cognitiveservices.azure.com/language/:analyze-conversations?api-version=2022-10-01-preview",
  key: NLU_KEY,
  deploymentName: "Appointment",
  projectName: "Appointment",
};

const settings = {
  azureLanguageCredentials,
  azureCredentials,
  asrDefaultCompleteTimeout: 0,
  asrDefaultNoInputTimeout: 5000,
  locale: "en-US",
  ttsDefaultVoice: "en-US-DavisNeural",
};

const grammar = {
  vlad: { person: "Vladislav Maraev" },
  aya: { person: "Nayat Astaiza Soriano" },
  rasmus: { person: "Rasmus Blanck" },
  david: { person: "David" },
  monday: { day: "Monday" },
  tuesday: { day: "Tuesday" },
  "10": { time: "10:00" },
  "11": { time: "11:00" },
  yes: { response: "yes" },
  no: { response: "no" },
  "nelson mandela": { person:"Nelson Mandela", response: "Nelson Mandela was South Africa's President." },
  "fidel castro": { person:"Fidel Castro", response: "Fidel Castro was Cuba's President." },
  "indira gandhi": { person:"Indira Gandhi", response: "Indira Gandhi was India's PM." },
  "kobe bryant": { person:"Kobe Bryant", response: "Kobe Bryant was a basketball player." },
  "noam chomsky": { person:"Noam Chomsky", response: "Noam Chomsky is the father of generative grammar." },
  "dag hammarskjöld": { person:"Dag Hammarskjöld", response: "Dag Hammarskjöld was UN secretary general." },
  "donald trump": { person:"Donald Trump", response: "Donald Trump is a former US president." },
  "vladimir putin": { person:"Vladimir Putin", response: "Vladimir Putin is the current president of Russia." },
  "haile gebrselassie": { person:"Haile Gebrselassie", response: "Haile Gebrselassie is a long-distance runner." },
  "cristiano ronaldo": { person: "Cristiano Ronaldo", response: "Cristiano Ronaldo is a footballer." },
};


function isInGrammar(utterance) {
  const normalized = utterance.trim().toLowerCase();
  console.log(`Checking if '${normalized}' is in grammar...`);
  return grammar[normalized] !== undefined;
}

function getPerson(utterance) {
  return grammar[utterance.toLowerCase()]?.person || "";
}

function getResponse(utterance) {
  return grammar[utterance.toLowerCase()]?.response || null;
}

function isValidInput(utterance, type) {
  return grammar[normalizeUtterance(utterance)]?.[type] !== undefined;
}

const normalizeUtterance = (utterance) =>
  utterance?.trim().toLowerCase().replace(/[?.,!]/g, "");


const dmMachine = setup({
  actions: {
    // Define your actions here
  },
}).createMachine({
  context: {
    count: 0,
    meetingWithName: "",
    meetingDate: "",
    meetingTime: "",
    AskName: "",
    GetPersonInfo: "",
    isWholeDay: false,
    ssRef: null,
    response: "",
  },
  id: "DM",
  initial: "Prepare",
  states: {
    Prepare: {
      entry: [
        assign({
          ssRef: ({ spawn }) => spawn(speechstate, { input: settings }),
        }),
        ({ context }) => context.ssRef.send({ type: "PREPARE" }),
      ],
      on: { ASRTTS_READY: "CreateAppointment" },
    },
    CreateAppointment: {
      initial: "Start",
      states: {
        Start: {
          entry: ({ context }) =>
            context.ssRef.send({
              type: "SPEAK",
              value: {
                utterance: "Hello, how can I help you today? Do you want to create a meeting or know about someone?",
              },
            }),
          on: { SPEAK_COMPLETE: "ListenToStart" },
        },
        ListenToStart: {
          entry: ({ context }) =>
            context.ssRef.send({
              type: "LISTEN",
              value: { nlu: true },
            }),
          on: {
            RECOGNISED: [
              {
                //guard: ({ event }) => normalizeUtterance(event.nluvalue?.[0]?.utterance) === "create a meeting",
                guard: ({ event }) => event.nluvalue.intents[0] === "create a meeting",
                target: "#DM.CreateAppointment.AskName",
              },
              {
                //guard: ({ event }) => normalizeUtterance(event.nluvalue?.[0]?.utterance) === "know who",
                guard: ({ event }) => event.nluvalue.intents[0] === "know who",
                target: "#DM.KnowWho.AskWho",
              },
            ],
            after: { 10000: "PromptRetry" },
          },
        },
        PromptRetry: {
          entry: ({ context }) =>
            context.ssRef.send({
              type: "SPEAK",
              value: {
                utterance: "I didn't catch that. Could you try again? Do you want to create a meeting or know about someone?",
              },
            }),
          on: { SPEAK_COMPLETE: "ListenToStart" },
        },
        AskName: {
          entry: ({ context }) =>
            context.ssRef.send({
              type: "SPEAK",
              value: {
                utterance: "Who would you like to meet?",
              },
            }),
          on: { SPEAK_COMPLETE: "MeetingWithName" },
        },
        MeetingWithName: {
          entry: ({ context }) =>
            context.ssRef.send({
              type: "LISTEN",
              value: { nlu: true },
            }),
          on: {            
            RECOGNISED: [
              {
                guard: ({ event }) => {
                  const utterance = event.nluvalue[0]?.utterance.trim().toLowerCase();
                  const confidence = event.value[0]?.confidence || 0;
                  const isValidName = isInGrammar(utterance);
                  const isAboveThreshold = confidence >= 0.7;
            
                  console.log(
                    `Recognized utterance: '${utterance}', Confidence: ${confidence}, In Grammar: ${isValidName}, Above Threshold: ${isAboveThreshold}, Valid: ${isValidName && isAboveThreshold}`
                  );
            
                  return isValidName && isAboveThreshold;
                },
                actions: assign({
                  meetingWithName: ({ event }) =>
                    getPerson(event.value[0]?.utterance.trim().toLowerCase()),
                }),
                target: "GetMeetingDay",
              },
            ],           
          },
        },        
        GetMeetingDay: {
          entry: ({ context }) => {
            const prompt = "Which day would you like to schedule the meeting?";
            console.log("Prompting user with:", prompt);
            context.ssRef.send({
              type: "SPEAK",
              value: { utterance: prompt },
            });
          },
          on: {
            SPEAK_COMPLETE: "ListenMeetingDay",
          },
        },
        ListenMeetingDay: {
          entry: ({ context }) =>
            context.ssRef.send({
              type: "LISTEN",
              value: { nlu: true },
            }),
          on: {
            RECOGNISED: {
              target: "IsWholeDay",
              actions: assign({
                meetingDate: ({ event }) => event.nluvalue[0]?.utterance.toLowerCase(),
              }),
            },
          },
        },
        IsWholeDay: {
          entry: ({ context }) =>
            context.ssRef.send({
              type: "SPEAK",
              value: { utterance: "Will it take the whole day?" },
            }),
          on: { SPEAK_COMPLETE: "CheckWholeDay" },
        },
        CheckWholeDay: {
          entry: ({ context }) =>
            context.ssRef.send({
              type: "LISTEN",
              value: { nlu: true },
            }),
          on: {
            RECOGNISED: [
              {
                //guard: ({ event }) => event.nluvalue[0]?.utterance.toLowerCase() === "yes",
                guard: ({ event }) => event.nluvalue.intents[0] === "yes",
                target: "ConfirmWholeDayAppointment",
                actions: assign({ isWholeDay: true }),
              },
              {
                //guard: ({ event }) => event.nluvalue[0]?.utterance.toLowerCase() === "no",
                guard: ({ event }) => event.nluvalue.intents[0] === "no",
                target: "GetMeetingTime",
                actions: assign({ isWholeDay: false }),
              },
            ],
          },
        },
        GetMeetingTime: {
          entry: ({ context }) =>
            context.ssRef.send({
              type: "SPEAK",
              value: { utterance: "What time is your meeting?" },
            }),
          on: { SPEAK_COMPLETE: "ListenMeetingTime" },
        },
        ListenMeetingTime: {
          entry: ({ context }) =>
            context.ssRef.send({
              type: "LISTEN",
              value: { nlu: true },
            }),
          on: {
            RECOGNISED: {
              target: "ConfirmAppointment",
              actions: assign({
                meetingTime: ({ event }) => event.nluvalue[0]?.utterance.toLowerCase(),
              }),
            },
          },
        },
        ConfirmWholeDayAppointment: {
          entry: ({ context }) =>
            context.ssRef.send({
              type: "SPEAK",
              value: {
                utterance: `Do you want to create an appointment with ${context.meetingWithName} on ${context.meetingDate} for the whole day?`,
              },
            }),
          on: { SPEAK_COMPLETE: "ListenConfirmation" },
        },
        ConfirmAppointment: {
          entry: ({ context }) =>
            context.ssRef.send({
              type: "SPEAK",
              value: {
                utterance: `Do you want to create an appointment with ${context.meetingWithName} on ${context.meetingDate} at ${context.meetingTime}?`,
              },
            }),
          on: { SPEAK_COMPLETE: "ListenConfirmation" },
        },
        ListenConfirmation: {
          entry: ({ context }) =>
            context.ssRef.send({
              type: "LISTEN",
              value: { nlu: true },
            }),
          on: {
            RECOGNISED: [
              {
                //guard: ({ event }) => event.nluvalue[0]?.utterance.toLowerCase() === "yes",
                guard: ({ event }) => event.nluvalue.intents[0] === "yes",
                target: "AppointmentCreated",
              },
              {
                //guard: ({ event }) => event.nluvalue[0]?.utterance.toLowerCase() === "no",
                guard: ({ event }) => event.nluvalue.intents[0] === "no",
                target: "AppointmentNotCreated",
              },
            ],
          },
        },
        AppointmentCreated: {
          entry: ({ context }) =>
            context.ssRef.send({
              type: "SPEAK",
              value: { utterance: "Your appointment has been created." },
            }),
          type: "final",
        },
        AppointmentNotCreated: {
          entry: ({ context }) =>
            context.ssRef.send({
              type: "SPEAK",
              value: { utterance: "Your appointment has not been created." },
            }),
          type: "final",          
        },
      },
    },
    KnowWho: {
      initial: "AskWho",
      states: {
        AskWho: {
          entry: ({ context }) =>
            context.ssRef.send({
              type: "SPEAK",
              value: { utterance: "Who would you like to know more about?" },
            }),
          on: { SPEAK_COMPLETE: "ListenKnowWho" },
        },
        ListenKnowWho: {
          entry: ({ context }) =>
            context.ssRef.send({
              type: "LISTEN",
              value: { nlu: true },
            }),
          on: {          
          RECOGNISED: [
            {
              guard: ({ event }) => {
                const utterance = event.nluvalue[0]?.utterance.trim().toLowerCase();
                const confidence = event.value[0]?.confidence || 0;
                const isValidName = isInGrammar(utterance);
                const isAboveThreshold = confidence >= 0.7;
          
                console.log(
                  `Recognized utterance: '${utterance}', Confidence: ${confidence}, In Grammar: ${isValidName}, Above Threshold: ${isAboveThreshold}, Valid: ${isValidName && isAboveThreshold}`
                );
          
                return isValidName && isAboveThreshold;
              },
              actions: assign({
                meetingWithName: ({ event }) =>
                  getPerson(event.value[0]?.utterance.trim().toLowerCase()),
              }),
              target: "GivePersonalInfo",
            },
          ],
          },
        },        
        GivePersonalInfo: {
          entry: [
            ({ context, event }) => {
              const utterance = event.nluvalue[0]?.utterance.trim().toLowerCase();
              const confidence = event.value[0]?.confidence || 0;
              const isValidName = isInGrammar(utterance);
              const isAboveThreshold = confidence >= 0.7;

              if (isValidName && isAboveThreshold) {
                const response = getResponse(utterance);
                context.response =
                  response || "I don't have information about that person.";
              } else {
                context.response =
                  "I'm sorry, I couldn't confidently recognize the name.";
              }
            },
            ({ context }) =>
              context.ssRef.send({
                type: "SPEAK",
                value: {
                  utterance: `You asked about ${context.response}`,
                },
              }),
          ],
          on: { SPEAK_COMPLETE: "MoreHelp" },          
        },
        MoreHelp: {
          entry: ({ context }) =>
            context.ssRef.send({
              type: "SPEAK",
              value: {
                utterance: "Do you need anything else?",
              },
            }),
          on: { SPEAK_COMPLETE: "ListenCheckMoreHelp" },
        },        
        ListenCheckMoreHelp: {
          entry: ({ context }) =>
            context.ssRef.send({
              type: "LISTEN",
              value: { nlu: true },
            }),
          on: {
            RECOGNISED: [
              {
                //guard: ({ event }) => event.value[0]?.utterance.toLowerCase() === "yes",
                guard: ({ event }) => event.nluvalue.intents[0] === "yes",
                //target: "#DM.CreateAppointment.AskName",
                target: "#DM.Prepare",
              },
              {
                //guard: ({ event }) => event.value[0]?.utterance.toLowerCase() === "no",
                guard: ({ event }) => event.nluvalue.intents[0] === "no",
                // target: "#DM.Prepare",
                target: "#DM.Complete", 
              },
            ],
          },
        },
        NotGrammar: {
          entry: ({ context }) =>
            context.ssRef.send({
              type: "SPEAK",
              value: { utterance: "Sorry, I didn’t understand that." },
            }),
          on: { SPEAK_COMPLETE: "AskWho" },
        },
      },
    },
    Complete: {
      id: "Complete",
      initial: "SpeakingComplete",
      states: { 
        SpeakingComplete: { 
          entry: {
            type: "say",
            params: "Thank you for using this App!",
          },
          on: {
            SPEAK_COMPLETE: "Done",
          },
        },
        Done: {
          type: "final",
          entry: [
            assign({
              ssRef: ({ spawn }) => spawn(speechstate, { input: settings }),
            }),
            ({ context }) => {
              console.log(
                "Service completed. Restarting or resetting if necessary."
              );
            },
          ],
        },
      },
      onDone: {
        target: "Prepare",
      },
    },        
  },
});
const dmActor = createActor(dmMachine, {
  inspect: inspector.inspect,
}).start();

dmActor.subscribe((state) => {
  console.log("Current state:", state.value);
  console.log("Meeting with: ", state.context.meetingWithName);
});

export function setupButton(element) {
  element.addEventListener("click", () => {
    dmActor.send({ type: "CLICK" });
  });
};








































// import { assign, createActor, setup } from "xstate";
// import { speechstate } from "speechstate";
// import { createBrowserInspector } from "@statelyai/inspect";
// import { KEY, NLU_KEY } from "./azure.js";

// const inspector = createBrowserInspector();


// const azureCredentials = {
//     endpoint:"https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
//     key: KEY,
// };

// const azureLanguageCredentials = {
//     endpoint: "https://260026.cognitiveservices.azure.com/language/:analyze-conversations?api-version=2022-10-01-preview",
//     key: NLU_KEY,
//     deploymentName: "Appointment",
//     projectName: "Appointment",

// };

// const settings = {
//     azureLanguageCredentials: azureLanguageCredentials,
//     azureCredentials: azureCredentials,
//     asrDefaultCompleteTimeout: 0,
//     asrDefaultNoInputTimeout: 5000,
//     local: "en-US",
//     ttsDefaultVoice: "en-US-DavisNeural",

// }

// /* Grammar defination */
// const grammar = {
//   vlad: { person: "Vladislav Maraev" },
//   aya: { person: "Nayat Astaiza Soriano" },
//   rasmus: { person: "Rasmus Blanck" },
//   david:{person: "David "},
//   monday: { day: "Monday" },
//   tuesday: { day: "Tuesday" },
//   "10": { time: "10:00" },
//   "11": { time: "11:00" },
//   yes: { response: "yes" },
//   no: { response: "no" },
//   nelson: { response: "Nelson Mandela was South Africa's President." },
//   castro: { response: "Fidel Castro was Cuba's President."},
//   gandhi: { response: "Indira Gandhi was India's PM."},
//   kobe: { response: "Kobe Bryant was Basketball player."},
//   chomsky: { response: "Noam Chomsky is father of generative grammar."},
//   dag: { response: "Dag Hammarskjöld was UN secretary general."},
//   trump: { response: "Donald Trump is former US president."},
//   putin: { response: "Vladimir Putin is current Russia president"},
//   haile: { response: "Haile Gebreselassie is long distance runner."},
//   christiano: { response: "Christiano Ronaldo is footballer."},

// };


// /* Helper functions */
// function isInGrammar(utterance) {
//   return utterance.toLowerCase() in grammar;
// }

// function getPerson(utterance) {
//   return (grammar[utterance.toLowerCase()] || {}).person;
// }

// const dmMachine = setup({
//   actions: {
//     /* define your actions here */

//   },
// }).createMachine({
//   context: {
//     count: 0,
//     meetingWithName: "",
//     meetingDate: "",
//     meetingTime: "",
//     isWholeDay: false,
//     ssRef: null,
//   },
// //   id: "DM",
// //   initial: "Prepare",
// //   states: {
// //     Prepare: {
// //       entry: [
// //         assign({
// //           ssRef: ({ spawn }) => spawn(speechstate, { input: settings }),
// //         }),
// //         ({ context }) => context.ssRef.send({ type: "PREPARE" }),
// //       ],
// //       on: { ASRTTS_READY: "WaitToStart" },
// //     },
// //     WaitToStart: {
// //       on: {
// //         CLICK: "PromptAndAsk",
// //       },
// //     },
// //     PromptAndAsk: {
// //       initial: "Prompt",
// //       states: {
// //         Prompt: {
// //           entry: ({ context }) =>
// //             context.ssRef.send({
// //               type: "SPEAK",
// //               value: {
// //                 utterance: `Hello world!`,
// //               },
// //             }),
// //           on: { SPEAK_COMPLETE: "Ask" },
// //         },
// //         Ask: {
// //           entry: ({ context }) =>
// //             context.ssRef.send({
// //               type: "LISTEN",
// //             }),
// //           on: {
// //             RECOGNISED: {
// //               actions: ({ context, event }) =>
// //                 context.ssRef.send({
// //                   type: "SPEAK",
// //                   value: {
// //                     utterance: `You just said: ${
// //                       event.value[0].utterance
// //                     }. And it ${
// //                       isInGrammar(event.value[0].utterance) ? "is" : "is not"
// //                     } in the grammar.`,
// //                   },
// //                 }),
// //             },
// //             SPEAK_COMPLETE: "#DM.Done",
// //           },
// //         },
// //       },
// //     },
// //     Done: {
// //       on: {
// //         CLICK: "PromptAndAsk",
// //       },
// //     },
// //   },
// // });

// id: "DM",
//   initial: "Prepare",
//   states:{
//     Prepare: {
//       entry:[
//         assign({
//           ssRef:({ spawn }) => spawn(speechstate, { input: settings }),
//         }),
//         ({ context }) => context.ssRef.send({ type: "PREPARE" }),
//       ],
//       on: { ASRTTS_READY: "CreateAppointment" },
//     },
//     CreateAppointment: {
//       initial: "Start",
//       states: {
//         Start: {
//           entry: ({ context }) =>
//            context.ssRef.send({
//             type: "SPEAK",
//             value: {
//               utterance: "Hello, how can I help you?",
//             },
//            }),
//            on: {SPEAK_COMPLETE: "GetName" },
//         },
//         ListenToStart:{
//           entry: { type: "listen" },
//           on: {
//             RECOGNISED: [
//               {
//                 guard: ({ event }) => event.value?.[0]?.utterance?.toLowerCase() === "Create a meeting",
//                 target: "",
//               },
//               {
//                 guard: ({ event }) => event.value?.[0]?.utterance?.toLowerCase() === "know who",
//                 target: "",
//               },
//             ]

//           }

//         },
//         GetName: {
//           entry: ({ context }) =>
//           context.ssRef.send({
//             type: "LISTEN",
//             value: { nlu: true }
//           }),

//           on: {
//             RECOGNISED: {
//               target: "GetMeetingDay",
//               actions: assign({
//                 meetingWithName:({ event }) => event.value[0].utterance.toLowerCase(),
//               }),

//             },
//           },
//         },
//         GetMeetingDay: {
//           entry: ({ context }) =>
//           context.ssRef.send({
//             type: "SPEAK",
//             value: {
//               utterance: "On which day is your meeting?",
//             },
//           }),
//           on: { SPEAK_COMPLETE: "ListenMeetingDay" },
//         },

//         ListenMeetingDay: {
//           entry: ({ context }) =>
//           context.ssRef.send({
//             type: "LISTEN",
//             value: { nlu: true }
//            }),
//            on: {
//             RECOGNISED: {
//               target: "IsWholeDay",
//               actions: assign({
//                 meetingDate: ({ event }) => event.value[0].utterance.toLowerCase(),
//               })
//             },
//            },

//         },
//         IsWholeDay: {
//           entry: ({ context }) =>
//           context.ssRef.send({
//             type: "SPEAK",
//             value: {
//               utterance: "Will it take the whole day?",
//             },
//           }),
//           on: {SPEAK_COMPLETE: "CheckWholDay" }, //"ListenWholeDay"
//         },
//         CheckWholDay: {
//           entry: ({ context }) =>
//           context.ssRef.send({
//             type: "LISTEN",
//             value: { nlu: true }
//           }),
//           on:{
//             RECOGNISED: [
//               {
//                 guard: ( { event }) => event.value[0].utterance.toLowerCase() === "yes",
//               target: "ConfirmWholeDayAppointment",
//               actions: assign({
//                 isWholeDay: "yes",

//               }),
//               },
//               {
//                 guard: ( { event }) => event.value[0].utterance.toLowerCase() === "no",
//                 target: "GetMeetingTime",
//                 actions: assign({
//                   isWholeDay: "no",
//                 }),
//               },
//             ],
//           },
//         },

//         GetMeetingTime: {
//           entry: ({ context }) =>
//           context.ssRef.send({
//             type: "SPEAK",
//             value: {
//               utterance: "What time is your meeting?",
//             },
//           }),
//           on: { SPEAK_COMPLETE: "ListenMeetingTime" },
//         },

//         ListenMeetingTime: {
//           entry: ({ context }) =>
//           context.ssRef.send({
//             type: "LISTEN",
//             value: { nlu: true } /** Local activation of NLU */,
//           }),

//         //   ({ context }) =>
//         //   context.ssRef.send({
//         //     type: "LISTEN",
//         //   }),
//         //activation of NLU */,
//           on: {
//             RECOGNISED:{
//               target: "ConfirmAppointment",
//               actions: assign({
//                 meetingTime: ( { event }) => event.value[0].utterance.toLowerCase(),
//               }),
//             },
//           },
//         },
//         ConfirmWholeDayAppointment: {
//           entry: ({ context }) =>
//           context.ssRef.send({
//             type: "SPEAK",
//             value: {
//               utterance: `Do you want to create an appointment with ${context.meetingWithName} on ${context.meetingDate} for the whole day?`,
//             },
//           }),
//           on: { SPEAK_COMPLETE: "ListenConfirmation" },
//         },

//         ConfirmAppointment: {
//           entry: ({ context }) =>
//           context.ssRef.send({
//             type: "SPEAK",
//             value: {
//               utterance: `Do you want to create an appointment with ${context.meetingWithName} on ${context.meetingDate} at ${context.meetingTime}?`,
//             },
//           }),
//           on: { SPEAK_COMPLETE: "ListenConfirmation" },
//         },
//         ListenConfirmation: {
//           entry: ({ context }) =>
//           context.ssRef.send({
//             type: "LISTEN",
//             value: { nlu: true }
//           }),
//           on: {
//             RECOGNISED: [
//               {
//                 guard: ( { event }) => event.value[0].utterance.toLowerCase() === "yes",
//                 target: "AppointmentCreated",
//               },
//               {
//                 guard: ( { event }) => event.value[0].utterance.toLowerCase() === "no",
//                 target: "AppointmentNotCreated",
//                 actions: assign({
//                   //meetingWithName: "",
//                   //meetingDate: "",
//                   meetingTime: "",
//                   isWholeDay: false,
//                 }),
//               },
//               //It should make ask you to reapet the same question..
//             ],
//           },
//         },
//         AppointmentCreated: {
//           entry: ({ context }) =>
//           context.ssRef.send({
//             type: "SPEAK",
//             value: {
//               utterance: "Your appointment has been created.",
//             },
//           }),
//           type: "final",
//         },
//         AppointmentNotCreated:{
//           entry: ({ context }) =>
//           context.ssRef.send({
//             type: "SPEAK",
//             value: {
//               utterance: "Your appointment has not been created.",
//             },
//           }),
//           type: "final",
//         },
//       },
//     },
//   },
// });

// const dmActor = createActor(dmMachine, {
//   inspect: inspector.inspect,
// }).start();

// dmActor.subscribe((state) => {
//   /* if you want to log some parts of the state */
//   console.log("Current state:", state.value);
//   console.log("Meeting with: ", state.context.meetingWithName);
// });

// export function setupButton(element) {
//   element.addEventListener("click", () => {
//     dmActor.send({ type: "CLICK" });
//   });
//   dmActor.getSnapshot().context.ssRef.subscribe((snapshot) => {
//     element.innerHTML = `${snapshot.value.AsrTtsManager.Ready}`;
//   });
// }

// dmActor.subscribe((state) => {
//   console.log(state)
// });