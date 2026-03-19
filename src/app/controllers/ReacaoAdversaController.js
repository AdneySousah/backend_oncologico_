import * as Yup from 'yup';
import XLSX from 'xlsx';
import fs from 'fs';
import ReacaoAdversa from '../models/ReacaoAdversa.js';

class ReacaoAdversaController {
  // CREATE (Vincular perfil profissional a um usuario existente)
  async store(req, res) {
    const { name } = req.body;
    // Sugestão: Normalizar para evitar duplicados (Ex: "Náusea" e "nausea")
    const exists = await ReacaoAdversa.findOne({ where: { name } });
    if (exists) return res.status(400).json({ error: 'Reação já cadastrada.' });

    const reacaoAdversa = await ReacaoAdversa.create({ name, active: true });
    return res.status(201).json(reacaoAdversa);
  }

  // INDEX (Listar profissionais com os dados do usuário juntos)
  async index(req, res) {
    const reacoesAdversas = await ReacaoAdversa.findAll({
      attributes: ['id', 'name', 'active'],
      order: [['name', 'ASC']]
    });
    return res.json(reacoesAdversas);
  }

  // UPDATE (Atualizar dados profissionais)
  async update(req, res) {
    // Logica similar ao update do User, buscando pelo ID do OncologyProfessional
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

    const reacaoAdversa = await ReacaoAdversa.findByPk(id);

    if (!reacaoAdversa) {
      return res.status(404).json({ error: 'Reação adversa not found' });
    }

    await reacaoAdversa.update({ name });

    return res.json(reacaoAdversa);
  }

  async delete(req, res) {
    const reacao = await ReacaoAdversa.findByPk(req.params.id);
    if (!reacao) return res.status(404).json({ error: 'Reação não encontrada' });

    await reacao.update({ active: !reacao.active }); // Inverte o status atual
    return res.json({ message: 'Status atualizado com sucesso' });
  }

  async validateExcel(req, res) {
    try {
      if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado.' });

      const workbook = XLSX.readFile(req.file.path);
      // range: 1 pula a primeira linha se for um cabeçalho descritivo (igual no seu de Medicamentos)
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

      const existentes = await ReacaoAdversa.findAll();
      const mapaExistentes = new Map(existentes.map(m => [m.name.toLowerCase().trim(), m]));

      const resumo = { novos: [], identicos: [], atualizacoes: [] }; // atualizações vazio pois só tem nome/status

      for (const item of data) {
        // Aceita várias variações do nome da coluna na planilha
        const nomeItem = item.nome || item.NOME || item.name || item.NAME || item.Reação || item['Reação Adversa'];
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

      const existentes = await ReacaoAdversa.findAll();
      const namesExistentes = new Set(existentes.map(m => m.name.toLowerCase().trim()));

      let inseridos = 0;
      const falhas = [];

      for (const item of data) {
        try {
          const nomeItem = item.nome || item.NOME || item.name || item.NAME || item.Reação || item['Reação Adversa'];
          if (!nomeItem) continue;

          const nameKey = String(nomeItem).toLowerCase().trim();

          // Cria se não existir
          if (!namesExistentes.has(nameKey)) {
            await ReacaoAdversa.create({ name: nomeItem, active: true });
            namesExistentes.add(nameKey); // Adiciona ao Set para evitar duplicatas na mesma planilha
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

export default new ReacaoAdversaController();