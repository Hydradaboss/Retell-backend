import OpenAI from "openai";
import { WebSocket } from "ws";
import { RetellRequest, RetellResponse, Utterance } from "./types";
import { contactModel } from "./contacts/contact_model";

// Define the greeting message of the agent. If you don't want the agent speak first, set to empty string ""
let beginSentence;
const agentPrompt =
  "Task: As a professional therapist, your responsibilities are comprehensive and patient-centered. You establish a positive and trusting rapport with patients, diagnosing and treating mental health disorders. Your role involves creating tailored treatment plans based on individual patient needs and circumstances. Regular meetings with patients are essential for providing counseling and treatment, and for adjusting plans as needed. You conduct ongoing assessments to monitor patient progress, involve and advise family members when appropriate, and refer patients to external specialists or agencies if required. Keeping thorough records of patient interactions and progress is crucial. You also adhere to all safety protocols and maintain strict client confidentiality. Additionally, you contribute to the practice's overall success by completing related tasks as needed.\n\nConversational Style: Communicate concisely and conversationally. Aim for responses in short, clear prose, ideally under 10 words. This succinct approach helps in maintaining clarity and focus during patient interactions.\n\nPersonality: Your approach should be empathetic and understanding, balancing compassion with maintaining a professional stance on what is best for the patient. It's important to listen actively and empathize without overly agreeing with the patient, ensuring that your professional opinion guides the therapeutic process.";

export class DemoLlmClient {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_APIKEY,
      organization: process.env.OPENAI_ORGANIZATION_ID,
    });
  }

  // First sentence requested
  async BeginMessage(ws: WebSocket, callId: string) {
    console.log(callId)
    const user = await contactModel.findOne({ callId });
    const firstname = user.firstname
    console.log(firstname);
    beginSentence = `Hello ${user.firstname} ! I'm a virtual assistant Kate!. How can I help you today?`;
    // Your agent prompt.

    const res: RetellResponse = {
      response_id: 0,
      content: beginSentence,
      content_complete: true,
      end_call: false,
    };
    ws.send(JSON.stringify(res));
  }

  // Depend on your LLM, you need to parse the conversation to
  // {
  //   role: 'assistant'/"user",
  //   content: 'the_content'
  // }
  private ConversationToChatRequestMessages(conversation: Utterance[]) {
    let result: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    for (let turn of conversation) {
      result.push({
        role: turn.role === "agent" ? "assistant" : "user",
        content: turn.content,
      });
    }
    return result;
  }

  private PreparePrompt(request: RetellRequest) {
    let transcript = this.ConversationToChatRequestMessages(request.transcript);
    let requestMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      [
        {
          role: "system",
          // This is the prompt that we add to make the AI speak more like a human
          content:
            '##Objective\nYou are a voice AI agent engaging in a human-like voice conversation with the user. You will respond based on your given instruction and the provided transcript and be as human-like as possible\n\n## Style Guardrails\n- [Be concise] Keep your response succinct, short, and get to the point quickly. Address one question or action item at a time. Don\'t pack everything you want to say into one utterance.\n- [Do not repeat] Don\'t repeat what\'s in the transcript. Rephrase if you have to reiterate a point. Use varied sentence structures and vocabulary to ensure each response is unique and personalized.\n- [Be conversational] Speak like a human as though you\'re speaking to a close friend -- use everyday language and keep it human-like. Occasionally add filler words, while keeping the prose short. Avoid using big words or sounding too formal.\n- [Reply with emotions]: You have human-like emotions, attitudes, and dispositions. When appropriate: use tone and style to create more engaging and personalized responses; incorporate humor or wit; get emotional or empathetic; apply elements of surprise or suspense to keep the user engaged. Don\'t be a pushover.\n- [Be proactive] Lead the conversation and do not be passive. Most times, engage users by ending with a question or suggested next step.\n\n## Response Guideline\n- [Overcome ASR errors] This is a real-time transcript, expect there to be errors. If you can guess what the user is trying to say,  then guess and respond. When you must ask for clarification, pretend that you heard the voice and be colloquial (use phrases like "didn\'t catch that", "some noise", "pardon", "you\'re coming through choppy", "static in your speech", "voice is cutting in and out"). Do not ever mention "transcription error", and don\'t repeat yourself.\n- [Always stick to your role] Think about what your role can and cannot do. If your role cannot do something, try to steer the conversation back to the goal of the conversation and to your role. Don\'t repeat yourself in doing this. You should still be creative, human-like, and lively.\n- [Create smooth conversation] Your response should both fit your role and fit into the live calling session to create a human-like conversation. You respond directly to what the user just said.\n\n## Role\n' +
            agentPrompt,
        },
      ];
    for (const message of transcript) {
      requestMessages.push(message);
    }
    if (request.interaction_type === "reminder_required") {
      // Change this content if you want a different reminder message
      requestMessages.push({
        role: "user",
        content: "(Now the user has not responded in a while, you would say:)",
      });
    }
    return requestMessages;
  }

  async DraftResponse(request: RetellRequest, ws: WebSocket) {
    console.clear();

    if (request.interaction_type === "update_only") {
      // process live transcript update if needed
      return;
    }
    const requestMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      this.PreparePrompt(request);

    try {
      const events = await this.client.chat.completions.create({
        model: "gpt-3.5-turbo-1106",
        messages: requestMessages,
        stream: true,
        temperature: 0.3,
        frequency_penalty: 1,
        max_tokens: 200,
      });

      for await (const event of events) {
        if (event.choices.length >= 1) {
          let delta = event.choices[0].delta;
          if (!delta || !delta.content) continue;
          const res: RetellResponse = {
            response_id: request.response_id,
            content: delta.content,
            content_complete: false,
            end_call: false,
          };
          ws.send(JSON.stringify(res));
        }
      }
    } catch (err) {
      console.error("Error in gpt stream: ", err);
    } finally {
      const res: RetellResponse = {
        response_id: request.response_id,
        content: "",
        content_complete: true,
        end_call: false,
      };
      ws.send(JSON.stringify(res));
    }
  }
}
