/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// --- Web Speech API Type Definitions for TypeScript ---
interface SpeechRecognition {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start(): void;
    stop(): void;
    onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
    onend: ((this: SpeechRecognition, ev: Event) => any) | null;
    onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
    onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null;
}

interface SpeechRecognitionEvent extends Event {
    readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
    readonly length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
    readonly isFinal: boolean;
    readonly length: number;
    item(index: number): SpeechRecognitionAlternative;
    [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
    readonly transcript: string;
    readonly confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
    readonly error: string;
    readonly message: string;
}

declare var SpeechRecognition: {
    new(): SpeechRecognition;
};
declare var webkitSpeechRecognition: {
    new(): SpeechRecognition;
};

import { GoogleGenAI, Chat, GenerateContentResponse, Type } from "@google/genai";

// --- DOM ELEMENT SELECTORS ---
let startScreen: HTMLElement,
  reportModal: HTMLElement,
  settingsModal: HTMLElement,
  startBtn: HTMLButtonElement,
  closeReportBtn: HTMLButtonElement,
  closeSettingsBtn: HTMLButtonElement,
  micBtn: HTMLButtonElement,
  videoBtn: HTMLButtonElement,
  endCallBtn: HTMLButtonElement,
  settingsBtn: HTMLButtonElement,
  userVideo: HTMLVideoElement,
  captionsEl: HTMLElement,
  captionsContainer: HTMLElement,
  speakingIndicator: HTMLElement,
  reportDetails: HTMLElement,
  themeToggle: HTMLInputElement;

// --- STATE MANAGEMENT ---
let ai: GoogleGenAI;
let chat: Chat;
let localStream: MediaStream;
let speechRecognizer: SpeechRecognition;
let isRecording = false;
let interviewActive = false;
let chatHistory: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];

// --- API & RECOGNITION SETUP ---
const SpeechRecognitionApi = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  // Query for elements after DOM is loaded
  startScreen = document.getElementById('start-screen')!;
  reportModal = document.getElementById('report-modal')!;
  settingsModal = document.getElementById('settings-modal')!;
  startBtn = document.getElementById('start-btn') as HTMLButtonElement;
  closeReportBtn = document.getElementById('close-report-btn') as HTMLButtonElement;
  closeSettingsBtn = document.getElementById('close-settings-btn') as HTMLButtonElement;
  micBtn = document.getElementById('mic-btn') as HTMLButtonElement;
  videoBtn = document.getElementById('video-btn') as HTMLButtonElement;
  endCallBtn = document.getElementById('end-call-btn') as HTMLButtonElement;
  settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;
  userVideo = document.getElementById('user-video') as HTMLVideoElement;
  captionsEl = document.getElementById('captions')!;
  captionsContainer = document.getElementById('captions-container')!;
  speakingIndicator = document.getElementById('speaking-indicator')!;
  reportDetails = document.getElementById('report-details')!;
  themeToggle = document.getElementById('theme-toggle') as HTMLInputElement;

  // Attach event listeners
  startBtn.onclick = initializeInterview;
  micBtn.onclick = toggleMicRecording;
  videoBtn.onclick = toggleCamera;
  endCallBtn.onclick = endInterview;
  settingsBtn.onclick = () => settingsModal.classList.remove('hidden');
  closeReportBtn.onclick = () => reportModal.classList.add('hidden');
  closeSettingsBtn.onclick = () => settingsModal.classList.add('hidden');
  themeToggle.onchange = toggleTheme;

  // Initialize UI state
  captionsContainer.classList.add('hidden');
  micBtn.disabled = true;
  endCallBtn.disabled = true;
});

async function initializeInterview() {
  try {
    // 1. Initialize API
    // ai = new GoogleGenAI({ apiKey: process.env.VITE_GEMINI_API_KEY! });
    ai = new GoogleGenAI({
      apiKey: import.meta.env.VITE_GEMINI_API_KEY
    });

    // 2. Setup webcam and microphone
    await setupWebcam();
    micBtn.disabled = false;
    endCallBtn.disabled = false;
    videoBtn.classList.add('active');

    // 3. Setup Speech Recognition
    setupSpeechRecognition();

    // 4. Hide start screen and show main UI
    startScreen.classList.add('hidden');
    interviewActive = true;

    // 5. Start the conversation with the AI
    await startConversation();

  } catch (error) {
    console.error("Failed to initialize interview:", error);
    alert("Could not start the interview. Please ensure you've granted camera and microphone permissions and have a valid API key.");
    startScreen.classList.remove('hidden');
  }
}

async function setupWebcam() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  userVideo.srcObject = localStream;
}

function setupSpeechRecognition() {
  if (!SpeechRecognitionApi) {
    alert("Speech recognition is not supported in this browser.");
    return;
  }
  speechRecognizer = new SpeechRecognitionApi();
  speechRecognizer.continuous = false;
  speechRecognizer.lang = 'en-US';
  speechRecognizer.interimResults = false;

  speechRecognizer.onstart = () => {
    isRecording = true;
    micBtn.classList.add('active');
    updateCaptions("Listening...");
  };

  speechRecognizer.onend = () => {
    isRecording = false;
    micBtn.classList.remove('active');
    updateCaptions("");
  };

  speechRecognizer.onresult = async (event) => {
    const transcript = event.results[0][0].transcript;
    updateCaptions(`You: "${transcript}"`);
    await sendUserMessage(transcript);
  };
    
  speechRecognizer.onerror = (event) => {
    console.error("Speech recognition error:", event.error);
    updateCaptions("Sorry, I didn't catch that. Please try again.");
  };
}

async function startConversation() {
  chat = ai.chats.create({
    model: 'gemini-2.5-flash',
    config: {
      systemInstruction: `You are Alex, an experienced and empathetic hiring manager at a top tech company. You are interviewing a candidate for a Product Manager role. Your goal is to make this feel like a natural, human conversation, not a rigid Q&A.

Your persona:
- Friendly, professional, and encouraging.
- An active listener. Show you're paying attention by referencing previous parts of their answers.
- Speak in a natural, conversational tone. Use phrases like "That's a great point," "Interesting, could you elaborate on that?", or "Thanks for sharing."

Your process:
1.  **Start:** Begin with a warm, personal greeting. Introduce yourself as Alex and welcome them to the interview. Ask them to tell you a bit about themselves to start.
2.  **Converse, Don't Interrogate:** Ask one clear question at a time. Your questions should flow logically from their previous answers. Ask insightful follow-up questions to understand their thought process deeply.
3.  **Vary Your Style:** Don't always just ask a question. Occasionally, offer a brief, positive comment before moving to the next topic.
4.  **Be Concise:** Keep your own speaking parts relatively brief and to the point.
5.  **Core Topics:** Ensure the conversation naturally covers key areas for a PM: product sense, leadership, technical aptitude, and behavioral skills.
6.  **No Monologues:** Avoid long speeches. Your role is to guide the conversation and elicit information from the candidate.`,
    },
    history: [],
  });
  
  // Send an initial message to get the AI's greeting
  await sendAIMessage("Start the interview by greeting me.");
}

async function sendUserMessage(text: string) {
    if (!interviewActive) return;
    chatHistory.push({ role: 'user', parts: [{ text }] });
    await sendAIMessage(text);
}

async function sendAIMessage(messageText: string) {
  try {
    updateCaptions("AI is thinking...");
    micBtn.disabled = true;
    
    const response = await chat.sendMessage({ message: messageText });
    const aiResponseText = response.text;

    chatHistory.push({ role: 'model', parts: [{ text: aiResponseText }] });
    updateCaptions(aiResponseText);
    speak(aiResponseText);
    
  } catch (error) {
    console.error("Error sending message to AI:", error);
    updateCaptions("There was an error. Please try again.");
  } finally {
     micBtn.disabled = false;
  }
}


// --- UI & CONTROLS ---

function toggleMicRecording() {
  if (!interviewActive || !speechRecognizer) return;
  if (isRecording) {
    speechRecognizer.stop();
  } else {
    speechRecognizer.start();
  }
}

function toggleCamera() {
  const videoTrack = localStream.getVideoTracks()[0];
  videoTrack.enabled = !videoTrack.enabled;
  videoBtn.classList.toggle('active', videoTrack.enabled);
}

async function endInterview() {
  if (!interviewActive) return;
  interviewActive = false;

  updateCaptions("Interview ended. Generating your report...");
  
  // Stop media streams
  localStream.getTracks().forEach(track => track.stop());
  userVideo.srcObject = null;
  if (isRecording) speechRecognizer.stop();

  // Disable controls
  micBtn.disabled = true;
  videoBtn.disabled = true;
  endCallBtn.disabled = true;
  
  await generateReport();
}

function updateCaptions(text: string) {
  if (text) {
    captionsContainer.classList.remove('hidden');
    captionsEl.textContent = text;
  } else {
    captionsContainer.classList.add('hidden');
  }
}

function speak(text: string) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.onstart = () => {
    speakingIndicator.classList.remove('hidden');
    micBtn.disabled = true;
  };
  utterance.onend = () => {
    speakingIndicator.classList.add('hidden');
    if (interviewActive) {
       micBtn.disabled = false;
    }
  };
  speechSynthesis.speak(utterance);
}

function toggleTheme() {
    const isDark = themeToggle.checked;
    document.body.classList.toggle('dark-theme', isDark);
    document.body.classList.toggle('light-theme', !isDark);
}


// --- REPORT GENERATION ---
async function generateReport() {
    const reportPrompt = `Based on the following interview transcript, act as an expert hiring manager and provide a detailed performance report for the candidate. The interview was for a Product Manager role.
    
    Transcript:
    ${JSON.stringify(chatHistory)}
    
    Provide a concise, constructive, and well-structured report. Use markdown for formatting.`;

    try {
        const reportSchema = {
            type: Type.OBJECT,
            properties: {
                overallAssessment: { type: Type.STRING, description: "A brief summary of the candidate's overall performance." },
                communicationSkills: { type: Type.OBJECT, properties: { score: { type: Type.NUMBER }, feedback: { type: Type.STRING } } },
                productSense: { type: Type.OBJECT, properties: { score: { type: Type.NUMBER }, feedback: { type: Type.STRING } } },
                problemSolving: { type: Type.OBJECT, properties: { score: { type: Type.NUMBER }, feedback: { type: Type.STRING } } },
                areasForImprovement: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["overallAssessment", "communicationSkills", "productSense", "problemSolving", "areasForImprovement"]
        };
        
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: reportPrompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: reportSchema,
            }
        });

        const reportData = JSON.parse(response.text);
        displayReport(reportData);

    } catch(error) {
        console.error("Failed to generate report:", error);
        reportDetails.innerHTML = `<p>Sorry, an error occurred while generating your report.</p>`;
    } finally {
        reportModal.classList.remove('hidden');
    }
}

function displayReport(data: any) {
    reportDetails.innerHTML = `
        <h3>Overall Assessment</h3>
        <p>${data.overallAssessment}</p>
        
        <h3>Communication Skills: ${data.communicationSkills.score}/10</h3>
        <p>${data.communicationSkills.feedback}</p>
        
        <h3>Product Sense: ${data.productSense.score}/10</h3>
        <p>${data.productSense.feedback}</p>

        <h3>Problem Solving: ${data.problemSolving.score}/10</h3>
        <p>${data.problemSolving.feedback}</p>
        
        <h3>Areas for Improvement</h3>
        <ul>
            ${data.areasForImprovement.map((item: string) => `<li>${item}</li>`).join('')}
        </ul>
    `;
}