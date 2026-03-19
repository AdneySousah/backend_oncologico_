import * as Yup from 'yup';
import { Op } from 'sequelize';
import XLSX from 'xlsx';
import fs from 'fs';
import PrestadorMedico from '../models/PrestadorMedico.js';


class PrestadorMedicoController {
    async store(req, res) {
        // Atualizamos o schema para garantir que o front enviou os dados do endereço
        const schema = Yup.object({
            nome: Yup.string().required(),
            cnpj: Yup.string().required(),
            cep: Yup.string().required(),
            logradouro: Yup.string().required(),
            bairro: Yup.string().required(),
            cidade: Yup.string().required(),
            estado: Yup.string().required(),
            tipo: Yup.string().oneOf(['hospital', 'clinica', 'laboratorio']).required(),
        });

        try {
            await schema.validate(req.body, { abortEarly: false });
        } catch (err) {
            return res.status(400).json({ error: err.errors });
        }

        // Criamos o prestador passando os dados que já vieram validados do frontend
        const prestadorMedico = await PrestadorMedico.create({
            nome: req.body.nome,
            cnpj: req.body.cnpj,
            cep: req.body.cep,
            logradouro: req.body.logradouro,
            numero: req.body.numero || 'S/N',
            complemento: req.body.complemento || '',
            bairro: req.body.bairro,
            cidade: req.body.cidade,
            estado: req.body.estado,
            tipo: req.body.tipo,
        });

        return res.status(201).json(prestadorMedico);
    }

    async index(req, res) {
        const { nome, cnpj, tipo, showInactives } = req.query;
        const where = {};

        if (nome) where.nome = { [Op.iLike]: `%${nome}%` };
        if (cnpj) where.cnpj = cnpj.replace(/\D/g, '');
        if (tipo) where.tipo = tipo;

        // Transforma explicitamente em booleano verificando a string
        const isShowingInactives = showInactives === 'true';

        // Se a caixinha NÃO estiver marcada, escondemos os inativos
        if (!isShowingInactives) {
            where.active = {
                [Op.or]: [
                    { [Op.eq]: true }, // É verdadeiro
                    { [Op.is]: null }  // Ou é nulo (cadastros antigos)
                ]
            };
        }

        // Isso vai imprimir no seu terminal do backend o que o Sequelize está buscando
        console.log("-> WHERE do Sequelize:", where);

        const prestadoresMedicos = await PrestadorMedico.findAll({
            where,
            order: [['nome', 'ASC']]
        });
        return res.json(prestadoresMedicos);
    }
    async update(req, res) {
        const { id } = req.params;
        const prestador = await PrestadorMedico.findByPk(id);

        if (!prestador) {
            return res.status(404).json({ error: 'Prestador não encontrado' });
        }

        // Como o frontend agora se encarrega de buscar o novo CEP e enviar
        // o logradouro, bairro, etc atualizados no req.body, só precisamos dar um update direto:
        await prestador.update(req.body);

        return res.json(prestador);
    }

    async delete(req, res) {
        const prestador = await PrestadorMedico.findByPk(req.params.id);
        if (!prestador) return res.status(404).json({ error: 'Prestador não encontrado' });

        await prestador.update({ active: !prestador.active });
        return res.json({ message: 'Status atualizado com sucesso' });
    }

    // VALIDAR EXCEL
    async validateExcel(req, res) {
        try {
            if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado.' });

            const workbook = XLSX.readFile(req.file.path);
            const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

            const existentes = await PrestadorMedico.findAll();
            // Mapeando pelo Nome/Razão Social para evitar duplicidade
            const mapaExistentes = new Map(existentes.map(m => [m.nome.toLowerCase().trim(), m]));

            const resumo = { novos: [], identicos: [], atualizacoes: [] };

            for (const item of data) {
                const nomeItem = item.nome || item.Nome || item.NOME || item.RazaoSocial;
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

            const existentes = await PrestadorMedico.findAll();
            const namesExistentes = new Set(existentes.map(m => m.nome.toLowerCase().trim()));

            let inseridos = 0;
            const falhas = [];

            for (const item of data) {
                try {
                    const nomeItem = item.nome || item.Nome || item.NOME || item.RazaoSocial;
                    if (!nomeItem) continue;

                    const nameKey = String(nomeItem).toLowerCase().trim();

                    if (!namesExistentes.has(nameKey)) {
                        // Como a tabela tem campos obrigatórios de endereço, preenchemos com valores padrão caso o Excel não os tenha
                        await PrestadorMedico.create({
                            nome: nomeItem,
                            cnpj: item.cnpj || item.CNPJ || '00.000.000/0000-00',
                            tipo: item.tipo ? String(item.tipo).toLowerCase() : 'clinica',
                            cep: item.cep || item.CEP || '00000000',
                            logradouro: item.logradouro || 'Não informado',
                            numero: item.numero || 'S/N',
                            complemento: item.complemento || '',
                            bairro: item.bairro || 'Não informado',
                            cidade: item.cidade || 'Não informado',
                            estado: item.estado || item.UF || 'XX',
                            active: true
                        });
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

export default new PrestadorMedicoController();