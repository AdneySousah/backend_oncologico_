import * as Yup from 'yup';
import XLSX from 'xlsx';
import fs from 'fs';
import Diagnostico from '../models/Diagnostico.js';

class DiagnosticoController {
  // CREATE
  async store(req, res) {
    const schema = Yup.object({
      diagnostico: Yup.string().required(),
    });

    try {
      await schema.validate(req.body, { abortEarly: false });
    } catch (err) {
      return res.status(400).json({ error: 'Falha na validação', messages: err.errors });
    }

    const { diagnostico } = req.body;

    const diagnosticoExists = await Diagnostico.findOne({ where: { diagnostico } });

    if (diagnosticoExists) {
      return res.status(400).json({ error: 'Diagnóstico já cadastrado.' });
    }

    const create_diagnostico = await Diagnostico.create({ diagnostico });

    return res.status(201).json(create_diagnostico);
  }

  // READ
  async index(req, res) {
    const diagnosticos = await Diagnostico.findAll({
      // ADICIONADO 'active'
      attributes: ['id', 'diagnostico', 'active'],
      order: [['diagnostico', 'ASC']]
    });

    return res.json(diagnosticos);
  }

  // DELETE (Ativar/Desativar diagnóstico)
  async delete(req, res) {
    const diag = await Diagnostico.findByPk(req.params.id);
    if (!diag) return res.status(404).json({ error: 'Diagnóstico não encontrado' });

    await diag.update({ active: !diag.active });
    return res.json({ message: 'Status atualizado com sucesso' });
  }

  // UPDATE (Nova Função)
  async update(req, res) {
    const schema = Yup.object({
      diagnostico: Yup.string().required(),
    });

    try {
      await schema.validate(req.body, { abortEarly: false });
    } catch (err) {
      return res.status(400).json({ error: 'Falha na validação', messages: err.errors });
    }

    const { id } = req.params;
    const { diagnostico } = req.body;

    const diag = await Diagnostico.findByPk(id);

    if (!diag) {
      return res.status(404).json({ error: 'Diagnóstico não encontrado.' });
    }

    // Verifica se já existe outro diagnóstico com o mesmo nome (evitar duplicidade no rename)
    if (diagnostico !== diag.diagnostico) {
      const exists = await Diagnostico.findOne({ where: { diagnostico } });
      if (exists) {
        return res.status(400).json({ error: 'Já existe um diagnóstico com este nome.' });
      }
    }

    await diag.update({ diagnostico });

    return res.json(diag);
  }


  async validateExcel(req, res) {
    try {
      if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado.' });

      const workbook = XLSX.readFile(req.file.path);
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

      const existentes = await Diagnostico.findAll();
      const mapaExistentes = new Map(existentes.map(m => [m.diagnostico.toLowerCase().trim(), m]));

      const resumo = { novos: [], identicos: [], atualizacoes: [] };

      for (const item of data) {
        // Aceita variações do nome da coluna
        const nomeItem = item.diagnostico || item.Diagnostico || item.DIAGNOSTICO || item.nome || item.name || item.CID;
        if (!nomeItem) continue;

        const nameKey = String(nomeItem).toLowerCase().trim();

        if (!mapaExistentes.has(nameKey)) {
          resumo.novos.push({ name: nomeItem });
        } else {
          resumo.identicos.push({ name: nomeItem });
        }
      }

      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

      return res.json(resumo);
    } catch (err) {
      console.error(err);
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(500).json({ error: 'Erro na validação do Excel.' });
    }
  }

  // IMPORTAR EXCEL
  async importExcel(req, res) {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

    const filePath = req.file.path;

    try {
      const workbook = XLSX.readFile(filePath);
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

      if (data.length === 0) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return res.status(400).json({ error: 'A planilha está vazia.' });
      }

      const existentes = await Diagnostico.findAll();
      const namesExistentes = new Set(existentes.map(m => m.diagnostico.toLowerCase().trim()));

      let inseridos = 0;
      const falhas = [];

      for (const item of data) {
        try {
          const nomeItem = item.diagnostico || item.Diagnostico || item.DIAGNOSTICO || item.nome || item.name || item.CID;
          if (!nomeItem) continue;

          const nameKey = String(nomeItem).toLowerCase().trim();

          if (!namesExistentes.has(nameKey)) {
            // Salva com active: true (certifique-se de que a migration adicionou active à tabela)
            await Diagnostico.create({ diagnostico: nomeItem, active: true });
            namesExistentes.add(nameKey);
            inseridos++;
          }
        } catch (innerErr) {
          falhas.push({ nome: item.diagnostico || 'Desconhecido', erro: innerErr.message });
        }
      }

      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      return res.json({ message: 'Importação finalizada!', inseridos, atualizados: 0, erros: falhas });
    } catch (err) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(500).json({ error: 'Erro interno ao processar planilha.' });
    }
  }
}

export default new DiagnosticoController();