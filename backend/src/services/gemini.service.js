const { GoogleGenAI } = require("@google/genai");

// Instantiates the new Google Gen AI SDK client
const apiKey = process.env.GEMINI_API_KEY?.trim().replace(/^['"]|['"]$/g, "");
let ai = null;

if (apiKey) {
  ai = new GoogleGenAI({ apiKey });
} else {
  console.warn("WARNING: GEMINI_API_KEY environment variable is not defined. AI question extraction will run in mock mode.");
}

// Enforces structural formatting rules for Gemini's response
const taxonomySchema = {
  type: "OBJECT",
  properties: {
    chapters: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "Chapter name extracted from document" },
          description: { type: "STRING", description: "Brief description of the chapter" },
          concepts: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING", description: "Concept or topic name under the chapter" },
                description: { type: "STRING", description: "Brief description of the concept" },
                questions: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      content: { type: "STRING", description: "The text of the question" },
                      type: { type: "STRING", enum: ["MCQ", "TRUE_FALSE", "SHORT_ANSWER", "ESSAY"] },
                      difficulty: { type: "STRING", enum: ["EASY", "MEDIUM", "HARD"] },
                      explanation: { type: "STRING", description: "Explanatory solution of the correct choice" },
                      answers: {
                        type: "ARRAY",
                        items: {
                          type: "OBJECT",
                          properties: {
                            content: { type: "STRING", description: "Answer text" },
                            isCorrect: { type: "BOOLEAN", description: "Flag if this choice is correct" }
                          },
                          required: ["content", "isCorrect"]
                        }
                      }
                    },
                    required: ["content", "type", "difficulty", "answers"]
                  }
                }
              },
              required: ["name", "questions"]
            }
          }
        },
        required: ["name", "concepts"]
      }
    }
  },
  required: ["chapters"]
};

class GeminiService {
  isTransientError(error) {
    const message = error.message || "";
    const causeCode = error.cause?.code || error.cause?.name || "";

    return message.includes("503") ||
      message.includes("UNAVAILABLE") ||
      message.includes("429") ||
      message.includes("ResourceExhausted") ||
      message.includes("high demand") ||
      message.includes("fetch failed") ||
      message.includes("Connect Timeout") ||
      causeCode === "UND_ERR_CONNECT_TIMEOUT" ||
      causeCode === "ConnectTimeoutError" ||
      error.status === "UNAVAILABLE" ||
      error.status === "RESOURCE_EXHAUSTED";
  }

  formatGeminiError(error) {
    const causeCode = error.cause?.code || error.cause?.name;
    if (error.status === 401 || error.message?.includes("401") || error.message?.includes("invalid authentication")) {
      return "Gemini authentication failed. Check GEMINI_API_KEY in backend/.env and use a valid Google AI Studio API key.";
    }

    if (causeCode === "UND_ERR_CONNECT_TIMEOUT" || error.message?.includes("fetch failed")) {
      return "Gemini network connection timed out. Please retry the upload; the backend now prefers IPv4 for Gemini connections.";
    }

    return error.message || "Unknown Gemini error";
  }

  async extractQuestionsFromDoc(fileBuffer, mimeType) {
    if (!ai) {
      // Mock mode fallback for local debugging if API key is omitted
      console.log("Mock Mode: Simulating Gemini document extraction...");
      return {
        chapters: [
          {
            name: "Introduction to Web Development",
            description: "Core concepts of web architectures, protocols, and client-server model.",
            concepts: [
              {
                name: "Programming Languages",
                description: "Compiled vs Interpreted languages.",
                questions: [
                  {
                    content: "Which of the following is a compiler-based language?",
                    type: "MCQ",
                    difficulty: "MEDIUM",
                    explanation: "C++ compiles down to native machine code, unlike interpreted scripts like JavaScript or Python.",
                    answers: [
                      { content: "JavaScript", isCorrect: false },
                      { content: "Python", isCorrect: false },
                      { content: "C++", isCorrect: true },
                      { content: "HTML", isCorrect: false }
                    ]
                  }
                ]
              },
              {
                name: "HTTP Protocol",
                description: "Statefulness and design of HTTP.",
                questions: [
                  {
                    content: "HTTP is a stateful protocol by design.",
                    type: "TRUE_FALSE",
                    difficulty: "EASY",
                    explanation: "HTTP is stateless; cookies and sessions are used to persist state.",
                    answers: [
                      { content: "True", isCorrect: false },
                      { content: "False", isCorrect: true }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      };
    }

    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        const prompt = "Extract all questions and their answer options (flagging which is correct) from the uploaded document. Do NOT generate explanations (set explanation to null or an empty string). Keep the chapters and concepts concise. Focus strictly on extracting all questions and answers correctly. Respond strictly matching the requested JSON schema.";

        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash-lite",
          contents: [
            {
              inlineData: {
                data: fileBuffer.toString("base64"),
                mimeType: mimeType
              }
            },
            prompt
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: taxonomySchema,
            temperature: 0.1, // Low temperature for higher accuracy/determinism
            maxOutputTokens: 8192
          }
        });

        const responseText = response.text || response.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!responseText) {
          throw new Error("Empty response received from Gemini API.");
        }

        return JSON.parse(responseText);
      } catch (error) {
        attempt++;
        const isTransient = this.isTransientError(error);

        if (isTransient && attempt < maxRetries) {
          const delay = attempt * 2000;
          console.warn(`Gemini API returned transient error (attempt ${attempt}/${maxRetries}). Retrying in ${delay}ms... Error: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.error("Gemini Extraction Error after retries:", error);
          throw new Error(`Gemini Parsing Failed: ${this.formatGeminiError(error)}`);
        }
      }
    }
  }

  async processAndPrintText(pdfText) {
    if (!ai) {
      console.log("Mock Mode: Printing input PDF text:\n", pdfText);
      return pdfText;
    }
    
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-lite",
        contents: [
          "Format the following text extracted from a PDF document to make it clean and highly readable. Do not extract chapters or alter the content:\n\n",
          pdfText
        ]
      });
      
      const processedText = response.text || response.candidates?.[0]?.content?.parts?.[0]?.text;
      console.log("Processed Gemini Text:\n", processedText);
      return processedText;
    } catch (error) {
      console.error("Gemini Text Processing Error:", error);
      throw new Error(`Gemini Text Processing Failed: ${error.message}`);
    }
  }
}

module.exports = new GeminiService();
