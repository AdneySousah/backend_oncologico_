import OpenAI from 'openai';
import fs from 'fs';/* 
import pdfParse from 'pdf-parse'; */
import mammoth from 'mammoth';

const openai = new OpenAI({
  apiKey: process.env.API_KEY_GPT,
});

export const extrairDadosDocumento = async (filePath, mimeType) => {
  let conteudoParaIA = [];

  const instrucoes = `
    Você é um assistente especializado em extração de dados médicos.
    Extraia as seguintes informações do paciente com base no documento fornecido.
    Retorne ESTRITAMENTE um objeto JSON válido, usando exatamente as chaves abaixo. 
    Se não encontrar a informação, retorne uma string vazia "".
    
    Chaves esperadas:
    - nomeCompleto
    - cpf (apenas números)
    - data_nascimento (no formato YYYY-MM-DD)
    - sexo (retorne "M", "F" ou "nao definido")
    - celular (apenas números)
    - telefone (apenas números)
    - cep (apenas números)
    - logradouro
    - numero
    - complemento
    - bairro
    - cidade
    - estado (apenas a sigla UF, ex: SP)
    - possui_cuidador (retorne true ou false)
    - nome_cuidador
    - contato_cuidador
    - medicamento_extraido (apenas o nome do medicamento e dosagem, se encontrar. Ex: "Aspirina 500mg")
  `;

  // 1. Se for Imagem (Usa a Visão Computacional)
  if (mimeType.includes('image')) {
    const imageAsBase64 = fs.readFileSync(filePath, { encoding: 'base64' });
    const dataUri = `data:${mimeType};base64,${imageAsBase64}`;
    conteudoParaIA = [
      { type: "text", text: instrucoes },
      { type: "image_url", image_url: { url: dataUri } }
    ];
  } 
  // 2. Se for PDF (Extrai o texto)
  else if (mimeType === 'application/pdf') {
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(dataBuffer);
    conteudoParaIA = [
      { type: "text", text: `${instrucoes}\n\nCONTEÚDO DO DOCUMENTO:\n${pdfData.text}` }
    ];
  } 
  // 3. Se for DOCX / Word (Extrai o texto)
  else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || mimeType === 'application/msword') {
    const wordData = await mammoth.extractRawText({ path: filePath });
    conteudoParaIA = [
      { type: "text", text: `${instrucoes}\n\nCONTEÚDO DO DOCUMENTO:\n${wordData.value}` }
    ];
  } 
  else {
    throw new Error("Formato de arquivo não suportado.");
  }

  // Envia para o GPT-4o
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: conteudoParaIA
      }
    ],
    response_format: { type: "json_object" }
  });

  return JSON.parse(response.choices[0].message.content);
};