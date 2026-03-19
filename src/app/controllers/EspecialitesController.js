import Especiality from '../models/Especiality.js';
import XLSX from 'xlsx';
import fs from 'fs';
import * as Yup from 'yup';

class EspecialitesController {
  // CREATE (Vincular perfil profissional a um usuario existente)
  async store(req, res) {
    const schema = Yup.object({
      name: Yup.string().required(),
    });

  
    try{
      await schema.validate(req.body, { abortEarly: false });
    }
    catch (err) {
      return res.status(400).json({ error: 'Validation fails', messages: err.errors });
    }

    const { name } = req.body;

    const speciality = await Especiality.create({ name });

    return res.status(201).json({ speciality });
  }

  // INDEX
  async index(req, res) {
    const especiality = await Especiality.findAll({
      // ADICIONADO O 'active' AQUI PARA O FRONTEND CONSEGUIR FILTRAR E RENDERIZAR
      attributes: ['id', 'name', 'active'], 
    });

    return res.json(especiality);
  }
  
  // UPDATE
  async update(req, res) {
    const schema = Yup.object({
      name: Yup.string().required(),
    });

    try {
      await schema.validate(req.body, { abortEarly: false });
    }
    catch (err) {
      return res.status(400).json({ error: 'Validation fails', messages: err.errors });
    }

    const { id } = req.params;
    const { name } = req.body;

    // CORRIGIDO DE Specialty PARA Especiality (conforme seu import)
    const specialty = await Especiality.findByPk(id); 

    if (!specialty) {
      return res.status(404).json({ error: 'Especialidade não encontrada' });
    }

    await specialty.update({ name });

    return res.json(specialty);
  }

  // DELETE
  async delete(req, res) {
    // CORRIGIDO DE Specialty PARA Especiality (conforme seu import)
    const specialty = await Especiality.findByPk(req.params.id); 
    if (!specialty) return res.status(404).json({ error: 'Especialidade não encontrada' });

    await specialty.update({ active: !specialty.active }); 
    return res.json({ message: 'Status atualizado com sucesso' });
  }
  
  async update(req, res) {
    const schema = Yup.object({
      name: Yup.string().required(),
    });

    try {
      await schema.validate(req.body, { abortEarly: false });
    }
    catch (err) {
      return res.status(400).json({ error: 'Validation fails', messages: err.errors });
    }

    const { id } = req.params;
    const { name } = req.body;

    const specialty = await Specialty.findByPk(id);

    if (!specialty) {
      return res.status(404).json({ error: 'Especialidade não encontrada' });
    }

    await specialty.update({ name });

    return res.json(specialty);
  }


  // VALIDAR EXCEL
  async validateExcel(req, res) {
    try {
      if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado.' });

      const workbook = XLSX.readFile(req.file.path);
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

      const existentes = await Especiality.findAll();
      const mapaExistentes = new Map(existentes.map(m => [m.name.toLowerCase().trim(), m]));

      const resumo = { novos: [], identicos: [], atualizacoes: [] };

      for (const item of data) {
        const nomeItem = item.nome || item.NOME || item.name || item.NAME || item.Especialidade || item.ESPECIALIDADE;
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

      const existentes = await Especiality.findAll();
      const namesExistentes = new Set(existentes.map(m => m.name.toLowerCase().trim()));

      let inseridos = 0;
      const falhas = [];

      for (const item of data) {
        try {
          const nomeItem = item.nome || item.NOME || item.name || item.NAME || item.Especialidade || item.ESPECIALIDADE;
          if (!nomeItem) continue;

          const nameKey = String(nomeItem).toLowerCase().trim();

          if (!namesExistentes.has(nameKey)) {
            await Especiality.create({ name: nomeItem, active: true });
            namesExistentes.add(nameKey); 
            inseridos++;
          }
        } catch (innerErr) {
          falhas.push({ nome: item.nome || 'Desconhecido', erro: innerErr.message });
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

export default new EspecialitesController();