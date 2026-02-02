import { GoogleGenAI, Type } from "@google/genai";
import { WasteAnalysis, HazardReport, WasteType, RecyclingCenter, HazardSeverity } from "../types";

const getApiKey = () => {
  // @ts-ignore
  return import.meta.env.VITE_GEMINI_API_KEY || '';
};

/**
 * Converts coordinates to a human-readable address using Gemini + Google Search.
 */
export const getAddressFromCoords = async (lat: number, lng: number): Promise<{address: string, url?: string, title?: string}> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { address: `${lat.toFixed(4)}, ${lng.toFixed(4)}` };
  }
  
  const ai = new GoogleGenAI({ apiKey });
  
  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: `Identify the physical street address and city in South Africa for these GPS coordinates: Latitude ${lat}, Longitude ${lng}. 
    Return ONLY the address in the format 'Street Name, City'. Do not include coordinates or extra text.`,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const address = response.text?.trim() || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  const chunk = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.[0]?.web;

  return { 
    address, 
    url: chunk?.uri,
    title: chunk?.title
  };
};

export const analyzeWasteImage = async (base64Image: string): Promise<WasteAnalysis> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    // Return mock data if no API key
    const mockTypes = [WasteType.PLASTIC, WasteType.GLASS, WasteType.METAL, WasteType.PAPER];
    const randomType = mockTypes[Math.floor(Math.random() * mockTypes.length)];
    const weight = Math.random() * 5 + 0.5;
    const valuePerKg = randomType === WasteType.METAL ? 12 : randomType === WasteType.PLASTIC ? 5 : 2;
    
    return {
      type: randomType,
      confidence: 0.85 + Math.random() * 0.15,
      estimatedWeight: parseFloat(weight.toFixed(2)),
      estimatedValue: parseFloat((weight * valuePerKg).toFixed(2)),
      itemsDetected: [`${randomType.toLowerCase()} bottles`, `${randomType.toLowerCase()} containers`],
      summary: `Detected ${randomType.toLowerCase()} recyclables`
    };
  }

  const ai = new GoogleGenAI({ apiKey });
  
  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: base64Image,
          },
        },
        {
          text: `Analyze this image for recyclables. Determine if the image contains recyclable goods (PLASTIC, GLASS, METAL, PAPER, or ELECTRONIC). 
          Estimate weight (kg) and ZAR value (Cans R12/kg, PET R5/kg, Paper R2/kg). 
          Return ONLY valid JSON format.`,
        },
      ],
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING, enum: ['PLASTIC', 'GLASS', 'METAL', 'PAPER', 'ELECTRONIC', 'NON_RECYCLABLE', 'UNKNOWN'] },
          confidence: { type: Type.NUMBER },
          estimatedWeight: { type: Type.NUMBER },
          estimatedValue: { type: Type.NUMBER },
          itemsDetected: { type: Type.ARRAY, items: { type: Type.STRING } },
          summary: { type: Type.STRING }
        },
        required: ["type", "estimatedWeight", "estimatedValue", "itemsDetected"]
      },
    },
  });

  return JSON.parse(response.text || "{}") as WasteAnalysis;
};

export const analyzeHazardImage = async (base64Image: string, voiceTranscript?: string): Promise<Partial<HazardReport>> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    // Return mock data if no API key
    const severities = [HazardSeverity.LOW, HazardSeverity.MEDIUM, HazardSeverity.HIGH, HazardSeverity.CRITICAL];
    return {
      severity: severities[Math.floor(Math.random() * severities.length)],
      description: "Environmental hazard detected and logged for municipal response.",
      referenceNumber: `HAZ-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
      acknowledgmentMessage: "Thank you for your report. Our environmental response team has been notified and will investigate this hazard within 24-48 hours."
    };
  }

  const ai = new GoogleGenAI({ apiKey });
  
  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: { 
      parts: [
        { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
        { text: `Identify this environmental hazard. Context: "${voiceTranscript || ''}". Return JSON with severity, description, and referenceNumber.` }
      ] 
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          severity: { type: Type.STRING, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
          description: { type: Type.STRING },
          referenceNumber: { type: Type.STRING },
          acknowledgmentMessage: { type: Type.STRING }
        },
        required: ["severity", "description", "referenceNumber"]
      },
    },
  });

  return JSON.parse(response.text || "{}");
};

/**
 * Transcribes audio using Gemini's flash model.
 */
export const transcribeAudio = async (base64Audio: string, sampleRate: number): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    return "Audio transcription not available without API key.";
  }

  const ai = new GoogleGenAI({ apiKey });
  
  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: `audio/pcm;rate=${sampleRate}`,
            data: base64Audio,
          },
        },
        { text: "Transcribe this audio recording precisely. It is a description of an environmental hazard. Return only the spoken text." }
      ],
    },
  });

  return response.text?.trim() || "";
};

export const findRecyclingLocations = async (location: string): Promise<RecyclingCenter[]> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    // Return mock data if no API key
    return [
      { name: 'GreenCycle Sandton', address: '123 Rivonia Road, Sandton', distance: '1.2km', phone: '011 234 5678', type: ['PLASTIC', 'METAL'], coordinates: { lat: -26.1076, lng: 28.0567 } },
      { name: 'Eco Waste Solutions', address: '45 Grayston Drive, Sandton', distance: '2.4km', phone: '011 345 6789', type: ['GLASS', 'PAPER'], coordinates: { lat: -26.1000, lng: 28.0500 } },
      { name: 'Recycle SA Hub', address: '78 William Nicol Drive', distance: '3.1km', phone: '011 456 7890', type: ['ELECTRONIC', 'METAL'], coordinates: { lat: -26.0900, lng: 28.0400 } },
      { name: 'Green Earth Recyclers', address: '12 Maude Street, Sandton', distance: '4.5km', phone: '011 567 8901', type: ['PLASTIC', 'PAPER', 'GLASS'], coordinates: { lat: -26.0800, lng: 28.0600 } },
    ];
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: `List 4 real recycling drop-off locations near ${location}, South Africa. Return JSON.`,
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            address: { type: Type.STRING },
            phone: { type: Type.STRING },
            type: { type: Type.ARRAY, items: { type: Type.STRING } },
            distance: { type: Type.STRING }
          }
        }
      }
    }
  });

  return JSON.parse(response.text || "[]");
};

export interface QuizQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

export const generateQuizQuestions = async (): Promise<QuizQuestion[]> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    // Return mock quiz questions if no API key
    return [
      {
        question: "What percentage of plastic waste in South Africa is recycled?",
        options: ["Less than 20%", "About 35%", "Over 50%", "Almost 75%"],
        answerIndex: 0,
        explanation: "Only about 14% of plastic waste is recycled in South Africa. Most ends up in landfills or the environment."
      },
      {
        question: "Which material takes the longest to decompose?",
        options: ["Paper bags", "Glass bottles", "Aluminum cans", "Plastic bottles"],
        answerIndex: 1,
        explanation: "Glass can take up to 1 million years to decompose, making recycling essential!"
      },
      {
        question: "What is the main cause of ocean pollution in South Africa?",
        options: ["Oil spills", "Plastic waste", "Industrial chemicals", "Agricultural runoff"],
        answerIndex: 1,
        explanation: "Plastic waste is the primary contributor to ocean pollution, with much coming from land-based sources."
      },
      {
        question: "How much energy is saved by recycling aluminum compared to making new aluminum?",
        options: ["25%", "50%", "75%", "95%"],
        answerIndex: 3,
        explanation: "Recycling aluminum saves about 95% of the energy needed to make new aluminum from raw materials!"
      },
      {
        question: "What is 'load shedding' in South Africa and how does it affect waste management?",
        options: ["A weight limit on garbage trucks", "Scheduled power outages affecting recycling facilities", "A method of waste sorting", "A type of composting"],
        answerIndex: 1,
        explanation: "Load shedding refers to scheduled power cuts. It disrupts recycling operations and waste processing facilities."
      }
    ];
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: "Generate 5 multiple choice questions about pollution, climate change, and recycling specific to South Africa. Include South African contexts like load shedding impacts on waste, local bird species affected by plastic, or SA waste management laws. Return as JSON array.",
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            question: { type: Type.STRING },
            options: { type: Type.ARRAY, items: { type: Type.STRING } },
            answerIndex: { type: Type.NUMBER },
            explanation: { type: Type.STRING }
          },
          required: ["question", "options", "answerIndex", "explanation"]
        }
      }
    }
  });
  
  return JSON.parse(response.text || "[]");
};
