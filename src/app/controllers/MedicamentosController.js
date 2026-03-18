
import * as Yup from 'yup';
import XLSX from 'xlsx';
import fs from 'fs';

import Medicamentos from '../models/Medicamentos.js';

class MedicamentosController {
  async store(req, res) {
    const schema = Yup.object({
      nome: Yup.string().required(),
      dosagem: Yup.string().required(),
      tipo_dosagem: Yup.string().oneOf(['MG', 'G', 'MCG', 'UI', 'ML', 'MG/ML']),
      codigo_tuss: Yup.string(),
      laboratorio: Yup.string(),
      tipo_produto: Yup.string(),
      principio_ativo: Yup.string(),
      descricao: Yup.string(),
      qtd_capsula: Yup.number(),
      nome_comercial: Yup.string(),
      price: Yup.number().positive(),
    });

    try {
      await schema.validate(req.body, { abortEarly: false });
    } catch (err) {
      return res.status(400).json({ error: 'Validation fails', messages: err.inner });
    }

    const { nome, dosagem, tipo_dosagem, codigo_tuss, laboratorio, tipo_produto, principio_ativo, descricao, qtd_capsula, nome_comercial, price } = req.body;

    // Sugestão de ajuste no Backend (store)
    const medicamentoExists = await Medicamentos.findOne({ where: { nome } });
    if (medicamentoExists) {
      return res.status(400).json({ error: 'Medicamento já cadastrado.' });
    }
    const novoMedicamento = await Medicamentos.create({ nome, dosagem, tipo_dosagem, codigo_tuss, laboratorio, tipo_produto, principio_ativo, descricao, qtd_capsula, nome_comercial, price });
    return res.status(201).json(novoMedicamento);
  }

  async index(req, res) {
    const medicamentos = await Medicamentos.findAll();
    return res.status(200).json(medicamentos);
  }


  async importExcel(req, res) {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }

    const filePath = req.file.path;

    try {
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];

      const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        defval: null,
        range: 1
      });

      if (data.length === 0) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return res.status(400).json({ error: 'A planilha está vazia.' });
      }

      const existentes = await Medicamentos.findAll({ attributes: ['codigo_tuss'] });
      const codigosExistentes = new Set(existentes.map(m => String(m.codigo_tuss)));

      let inseridos = 0;
      let atualizados = 0;
      const falhas = [];

      for (const item of data) {
        try {
          if (!item.nome && !item.PRODUTO) continue;

          const nomeStr = String(item.nome || item.PRODUTO);
          const regexDosagem = /([\d.,\s+()]+)\s*(MG|G|MCG|UI|ML|MG\/ML)/i;
          const match = nomeStr.match(regexDosagem);

          const valorDosagem = match ? match[1].trim() : null;
          const unidadeDosagem = match ? match[2].toUpperCase() : null;

          // CAPTURA RESILIENTE DE PREÇO
          const precoCru = item.price ?? item.PRECO ?? item['PREÇO'] ?? item[' price '] ?? null;
          const codTuss = (item.codigo_tuss || item['CODIGO TUSS']) ? String(item.codigo_tuss || item['CODIGO TUSS']) : null;

          // Tratamento de conversão de preço
          let priceFinal = 0;
          if (precoCru !== null) {
            priceFinal = typeof precoCru === 'string'
              ? parseFloat(precoCru.replace(/[R$\s.]/g, '').replace(',', '.'))
              : parseFloat(precoCru);
          }

          const medData = {
            codigo_tuss: codTuss,
            laboratorio: item.laboratorio || item.LABORATORIO || null,
            tipo_produto: item.tipo_produto || null,
            nome_comercial: item.nome_comercial || null,
            principio_ativo: item.principio_ativo || null,
            nome: nomeStr,
            descricao: item.descricao || null,
            qtd_capsula: item.qtd_capsula ? parseInt(item.qtd_capsula) : 0,
            dosagem: valorDosagem,
            tipo_dosagem: unidadeDosagem,
            price: priceFinal,
            updated_at: new Date()
          };

          if (codTuss && codigosExistentes.has(codTuss)) {
            await Medicamentos.update(
              { price: medData.price, updated_at: new Date() },
              { where: { codigo_tuss: codTuss } }
            );
            atualizados++;
          } else {
            await Medicamentos.create({ ...medData, created_at: new Date() });
            inseridos++;
          }
        } catch (innerErr) {
          falhas.push({ nome: item.nome || 'Desconhecido', erro: innerErr.message });
        }
      }

      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      return res.json({ message: 'Importação finalizada!', inseridos, atualizados, erros: falhas });

    } catch (err) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(500).json({ error: 'Erro interno ao processar planilha.' });
    }
  }

  async validateExcel(req, res) {
    try {
      if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado.' });

      const workbook = XLSX.readFile(req.file.path);
      // range: 1 para pular o cabeçalho informativo se necessário
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { range: 1 });

      const existentes = await Medicamentos.findAll();
      const mapaExistentes = new Map(existentes.map(m => [String(m.codigo_tuss), m]));

      const resumo = { novos: [], atualizacoes: [], identicos: [] };

      for (const item of data) {
        // Aceita 'nome' ou 'PRODUTO' (conforme sua planilha)
        const nomeItem = item.nome || item.PRODUTO;
        if (!nomeItem) continue;

        const codTuss = (item.codigo_tuss || item['CODIGO TUSS']) ? String(item.codigo_tuss || item['CODIGO TUSS']) : null;

        // CAPTURA RESILIENTE DE PREÇO (Igual ao import)
        const precoCru = item.price ?? item.PRECO ?? item['PREÇO'] ?? item[' price '] ?? 0;

        let precoPlanilha = 0;
        if (precoCru !== null) {
          precoPlanilha = typeof precoCru === 'string'
            ? parseFloat(precoCru.replace(/[R$\s.]/g, '').replace(',', '.'))
            : parseFloat(precoCru);
        }

        const medExistente = codTuss ? mapaExistentes.get(codTuss) : null;

        if (!medExistente) {
          resumo.novos.push({
            nome: nomeItem,
            codigo_tuss: codTuss,
            preco: precoPlanilha
          });
        } else {
          const precoBanco = parseFloat(medExistente.price || 0);

          // Usamos toFixed(2) para evitar problemas de precisão de ponto flutuante na comparação
          if (precoBanco.toFixed(2) !== precoPlanilha.toFixed(2)) {
            resumo.atualizacoes.push({
              nome: nomeItem,
              codigo_tuss: codTuss,
              precoAntigo: precoBanco,
              precoNovo: precoPlanilha
            });
          } else {
            resumo.identicos.push({ nome: nomeItem, codigo_tuss: codTuss });
          }
        }
      }

      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

      return res.json(resumo);
    } catch (err) {
      console.error(err);
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(500).json({ error: 'Erro na validação.' });
    }
  }


}


export default new MedicamentosController();