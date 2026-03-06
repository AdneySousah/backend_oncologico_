import * as Yup from 'yup';
import stringSimilarity from 'string-similarity';
import User from '../models/User.js';
import Pacientes from '../models/Pacientes.js';
import Operadora from '../models/Operadora.js';
import Medicamentos from '../models/Medicamentos.js'; // IMPORTAÇÃO ADICIONADA
import getAdress from '../../utils/getAdress.js';
import PacientesAnexos from '../models/PacientesAnexos.js';
import Sequelize, { Op } from 'sequelize';
import { parseExcel } from '../../utils/excelUtils.js';
import fs from 'fs';
import { getOperadoraFilter } from '../../utils/permissionUtils.js';
import { extrairDadosDocumento } from '../../services/openAiService.js';

class PacientesController {

    async getNomesAnexos(req, res) {
        try {
            const nomes = await PacientesAnexos.findAll({
                attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('nome')), 'nome']],
                raw: true,
                order: [['nome', 'ASC']]
            });
            return res.json(nomes.map(n => n.nome));
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao buscar nomes de anexos' });
        }
    }

    async store(req, res) {
        req.body.possui_cuidador = req.body.possui_cuidador === 'true';
        req.body.fez_entrevista = req.body.fez_entrevista === 'true';
        
        // Pega o ID que veio do Frontend e converte pra número
        req.body.operadora_id = Number(req.body.operadora_id);

        // --- CORREÇÃO: VALIDAÇÃO DE SEGURANÇA ---
        // Checa se o usuário tem permissão para cadastrar NAQUELA operadora específica
        const permission = await getOperadoraFilter(req.userId, req.body.operadora_id);
        if (!permission.authorized) {
            return res.status(permission.status || 403).json({ error: permission.error || "Você não tem permissão para cadastrar pacientes nesta operadora." });
        }
        // ----------------------------------------

        if (req.body.medicamento_id) {
            req.body.medicamento_id = Number(req.body.medicamento_id);
        } else {
            req.body.medicamento_id = null;
        }

        const schema = Yup.object({
            nome: Yup.string().required(),
            sobrenome: Yup.string().required(),
            celular: Yup.string().required(),
            telefone: Yup.string().nullable(),
            data_nascimento: Yup.date().required(),
            sexo: Yup.string().oneOf(['M', 'F', 'nao definido']).required(),
            possui_cuidador: Yup.boolean().required(),
            nome_cuidador: Yup.string().nullable(),
            contato_cuidador: Yup.string().nullable(),
            operadora_id: Yup.number().required(),
            medicamento_id: Yup.number().nullable(),
            cpf: Yup.string().required(),
            fez_entrevista: Yup.boolean().default(false),
            cep: Yup.string().required(),
            logradouro: Yup.string().required(),
            numero: Yup.string().required(),
            complemento: Yup.string().nullable(),
            bairro: Yup.string().required(),
            cidade: Yup.string().required(),
            estado: Yup.string().required()
        });

        try {
            await schema.validate(req.body, { abortEarly: false });
        } catch (err) {
            return res.status(400).json({ error: err.errors });
        }

        const formatarNome = (texto) => {
            if (!texto) return '';
            return texto.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        };
        req.body.nome = formatarNome(req.body.nome);
        req.body.sobrenome = formatarNome(req.body.sobrenome);

        const isCPF = await Pacientes.findOne({ where: { cpf: req.body.cpf.replace(/\D/g, '') } });
        if (isCPF) return res.status(400).json({ error: 'CPF já cadastrado para outro paciente.' });

        const isCelular = await Pacientes.findOne({ where: { celular: req.body.celular.replace(/\D/g, '') } });
        if (isCelular) return res.status(400).json({ error: 'Celular já cadastrado para outro paciente.' });

        if (req.body.telefone) {
            const istelefone = await Pacientes.findOne({ where: { telefone: req.body.telefone.replace(/\D/g, '') } });
            if (istelefone) return res.status(400).json({ error: 'Telefone já cadastrado para outro paciente.' });
        }

        try {
            const currentUser = await User.findByPk(req.userId);
            const isAdmin = currentUser && (currentUser.is_admin === true || String(currentUser.is_admin).toLowerCase() === 'true' || currentUser.is_admin === 1);
            
            req.body.is_new_user = !isAdmin;

            const paciente = await Pacientes.create(req.body);

            if (req.files && req.files.length > 0) {
                let nomesAnexos = req.body.anexos_nomes || [];
                if (!Array.isArray(nomesAnexos)) {
                    nomesAnexos = [nomesAnexos];
                }

                const anexosData = req.files.map((file, index) => ({
                    paciente_id: paciente.id,
                    nome: nomesAnexos[index] || 'Sem Nome',
                    file_path: file.filename,
                    original_name: file.originalname
                }));

                await PacientesAnexos.bulkCreate(anexosData);
            }

            const pacienteCriado = await Pacientes.findByPk(paciente.id, {
                include: [
                    {
                        model: PacientesAnexos,
                        as: 'anexos',
                        attributes: ['id', 'nome', 'file_path', 'original_name']
                    },
                    {
                        model: Medicamentos,
                        as: 'medicamento',
                        attributes: ['id', 'nome']
                    }
                ]
            });

            return res.status(201).json(pacienteCriado);

        } catch (err) {
            console.error("Erro no cadastro de paciente:", err);
            return res.status(500).json({ error: 'Erro ao cadastrar paciente', details: err.message });
        }
    }

    async update(req, res) {
        const { id } = req.params;

        try {
            const paciente = await Pacientes.findByPk(id);

            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }

            // --- CORREÇÃO: VALIDAÇÃO DE SEGURANÇA ---
            // Se tentarem alterar a operadora, verifica se o usuário tem permissão
            if (req.body.operadora_id && req.body.operadora_id !== paciente.operadora_id) {
                req.body.operadora_id = Number(req.body.operadora_id);
                const permission = await getOperadoraFilter(req.userId, req.body.operadora_id);
                if (!permission.authorized) {
                    return res.status(permission.status || 403).json({ error: permission.error || "Você não tem permissão para transferir este paciente para essa operadora." });
                }
            }
            // ----------------------------------------

            if (req.body.cpf) {
                const isCPF = await Pacientes.findOne({
                    where: { cpf: req.body.cpf.replace(/\D/g, ''), id: { [Op.ne]: id } }
                });
                if (isCPF) {
                    return res.status(400).json({ error: 'CPF já cadastrado para outro paciente.' });
                }
            }

            if (req.body.cep && req.body.cep !== paciente.cep) {
                const consulta = await getAdress(req.body.cep);

                if (consulta && !consulta[0].erro) {
                    const end = consulta[0];
                    req.body.logradouro = end.logradouro;
                    req.body.bairro = end.bairro;
                    req.body.cidade = end.localidade;
                    req.body.estado = end.uf;
                }
            }

            if (req.body.medicamento_id === '') {
                req.body.medicamento_id = null;
            }

            if (req.body.is_new_user !== undefined) {
                req.body.is_new_user = req.body.is_new_user === 'true' || req.body.is_new_user === true;
            }

            await paciente.update(req.body);

            if (req.files && req.files.length > 0) {
                let nomesAnexos = req.body.anexos_nomes || [];
                if (!Array.isArray(nomesAnexos)) {
                    nomesAnexos = [nomesAnexos];
                }

                const anexosData = req.files.map((file, index) => ({
                    paciente_id: paciente.id,
                    nome: nomesAnexos[index] || 'Sem Nome',
                    file_path: file.filename,
                    original_name: file.originalname
                }));

                await PacientesAnexos.bulkCreate(anexosData);
            }

            const pacienteAtualizado = await Pacientes.findByPk(id, {
                include: [
                    {
                        model: PacientesAnexos,
                        as: 'anexos',
                        attributes: ['id', 'nome', 'file_path', 'original_name']
                    },
                    {
                        model: Medicamentos,
                        as: 'medicamento',
                        attributes: ['id', 'nome']
                    }
                ]
            });

            return res.json(pacienteAtualizado);
        } catch (err) {
            console.error("Erro no update:", err);
            return res.status(500).json({ error: err.message || 'Erro ao atualizar paciente' });
        }
    }

    async index(req, res) {
        const { nome, cpf, operadora_id, status_active } = req.query;

        const permission = await getOperadoraFilter(req.userId, operadora_id);

        if (!permission.authorized) {
            if (permission.emptyResult) return res.json([]);
            return res.status(permission.status).json({ error: permission.error });
        }

        const where = permission.whereClause;

        if (nome) {
            where[Op.or] = [
                { nome: { [Op.iLike]: `%${nome}%` } },
                { sobrenome: { [Op.iLike]: `%${nome}%` } }
            ];
        }

        if (cpf) {
            where.cpf = cpf.replace(/\D/g, '');
        }

        if (status_active === 'false') {
            where.is_active = false;
        } else if (status_active === 'ambos' || status_active === 'todos') {
            // Não filtra por is_active
        } else {
            where.is_active = { [Op.not]: false };
        }

        try {
            const pacientes = await Pacientes.findAll({
                where,
                include: [
                    {
                        model: Operadora,
                        as: 'operadoras',
                        attributes: ['id', 'nome']
                    },
                    {
                        model: PacientesAnexos,
                        as: 'anexos',
                        attributes: ['id', 'nome', 'file_path', 'original_name']
                    },
                    {   // ADICIONADO AQUI PARA A LISTAGEM
                        model: Medicamentos,
                        as: 'medicamento',
                        attributes: ['id', 'nome', 'dosagem']
                    }
                ],
                order: [
                    ['is_new_user', 'DESC'],
                    ['nome', 'ASC']
                ]
            });

            return res.json(pacientes);
        } catch (err) {
            console.error("Erro no index de pacientes:", err);
            return res.status(500).json({ error: 'Erro ao buscar pacientes' });
        }
    }

    async importExcel(req, res) {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
        }

        const { operadora_id } = req.body;
        if (!operadora_id) {
            if (req.file.path) fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Operadora não informada.' });
        }

        const permission = await getOperadoraFilter(req.userId, operadora_id);

        if (!permission.authorized) {
            if (req.file.path) fs.unlinkSync(req.file.path);
            return res.status(permission.status).json({ error: permission.error });
        }

        const successes = [];
        const errors = [];
        const duplicates = [];

        try {
            const data = parseExcel(req.file.path);
            const currentUser = await User.findByPk(req.userId);
            const isNewUserFlag = currentUser && currentUser.is_admin ? false : true;

            const formatarNome = (texto) => {
                if (!texto) return '';
                return texto.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
            };

            for (const row of data) {
                const cpfRaw = row['cpf'] || row['CPF'];
                const cpf = cpfRaw ? String(cpfRaw).replace(/\D/g, '') : null;
                const nomeDaPlanilha = row['nome'] || row['Nome'];

                if (!cpf || !nomeDaPlanilha) continue;

                const pacienteExists = await Pacientes.findOne({ where: { cpf } });
                if (pacienteExists) {
                    const nomeDoBanco = `${pacienteExists.nome} ${pacienteExists.sobrenome || ''}`.trim();
                    duplicates.push({
                        nome: nomeDaPlanilha,
                        cpf,
                        motivo: `O CPF pertence ao paciente: ${nomeDoBanco}`
                    });
                    continue;
                }

                const cepRaw = row['cep'] || row['CEP'];
                const cep = cepRaw ? String(cepRaw).replace(/\D/g, '') : '';
                let enderecoData = {};

                if (cep && cep.length === 8) {
                    try {
                        const consultaEndereco = await getAdress(cep);
                        if (consultaEndereco && consultaEndereco.length > 0 && !consultaEndereco[0].erro) {
                            enderecoData = consultaEndereco[0];
                        }
                    } catch (err) {
                        console.log(`Erro ao buscar CEP ${cep}:`, err.message);
                    }
                }

                const cleanString = (val) => val ? String(val) : '';

                let dataNascimento = row['data_nascimento'] || row['Data_nascimento'] || null;
                if (typeof dataNascimento === 'number') {
                    const dataObj = new Date(Math.round((dataNascimento - 25569) * 86400 * 1000));
                    dataNascimento = dataObj.toISOString().split('T')[0];
                }

                // Permite a importação via planilha se passar "medicamento_id" na coluna
                const medicamentoIdRow = row['medicamento_id'] || row['Medicamento_id'];

                try {
                    await Pacientes.create({
                        nome: formatarNome(nomeDaPlanilha),
                        sobrenome: formatarNome(cleanString(row['sobrenome'] || row['Sobrenome'])),
                        celular: cleanString(row['celular'] || row['Celular']) || 'Não informado',
                        telefone: cleanString(row['telefone'] || row['Telefone']),
                        data_nascimento: dataNascimento || new Date(),
                        sexo: row['sexo'] || row['Sexo'] || 'nao definido',
                        possui_cuidador: (String(row['possui_cuidador']).toUpperCase() === 'SIM' || row['possui_cuidador'] === true),
                        nome_cuidador: cleanString(row['nome_cuidador'] || row['Nome_cuidador']),
                        contato_cuidador: cleanString(row['contato_cuidador'] || row['Contato_cuidador']),
                        cep: cep,
                        operadora_id: Number(operadora_id),
                        medicamento_id: medicamentoIdRow ? Number(medicamentoIdRow) : null, // ADICIONADO AQUI
                        cpf: cpf,
                        logradouro: enderecoData.logradouro || 'N/A',
                        numero: cleanString(row['numero'] || row['Numero']) || 'S/N',
                        complemento: cleanString(row['complemento'] || row['Complemento']),
                        bairro: enderecoData.bairro || 'N/A',
                        cidade: enderecoData.localidade || 'N/A',
                        estado: enderecoData.uf || 'N/A',
                        is_new_user: isNewUserFlag
                    });
                    successes.push({ nome: nomeDaPlanilha, cpf });
                } catch (err) {
                    errors.push({ nome: nomeDaPlanilha, cpf, erro: err.message });
                }
            }

            try { if (req.file.path) fs.unlinkSync(req.file.path); } catch (fileErr) { }

            return res.json({
                message: 'Processamento concluído',
                summary: { total_lido: data.length, importados: successes.length, duplicados: duplicates.length, erros: errors.length },
                detalhes: { duplicados: duplicates, erros: errors }
            });

        } catch (error) {
            return res.status(500).json({ error: 'Falha ao processar arquivo Excel', details: error.message });
        }
    }

    async validateImport(req, res) {
        // [CÓDIGO MANTIDO EXATAMENTE IGUAL - Nenhuma alteração necessária aqui]
        if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
        const { operadora_id } = req.body;
        if (!operadora_id) {
            if (req.file.path) fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Operadora não informada para validação.' });
        }
        const permission = await getOperadoraFilter(req.userId, operadora_id);
        if (!permission.authorized) {
            if (req.file.path) fs.unlinkSync(req.file.path);
            return res.status(permission.status).json({ error: permission.error });
        }
        const validos = [];
        const duplicados = [];
        const invalidos = [];
        try {
            const data = parseExcel(req.file.path);
            for (const row of data) {
                const cpfRaw = row['cpf'] || row['CPF'];
                const cpf = cpfRaw ? String(cpfRaw).replace(/\D/g, '') : null;
                const nomeDaPlanilha = row['nome'] || row['Nome'];
                if (!cpf || !nomeDaPlanilha) {
                    invalidos.push({ linha: row, motivo: 'Nome ou CPF ausente na planilha' });
                    continue;
                }
                const pacienteExists = await Pacientes.findOne({ where: { cpf } });
                if (pacienteExists) {
                    const nomeDoBanco = `${pacienteExists.nome} ${pacienteExists.sobrenome || ''}`.trim();
                    duplicados.push({
                        nome: nomeDaPlanilha,
                        cpf,
                        motivo: `CPF já cadastrado. O CPF pertence a: ${nomeDoBanco}`
                    });
                } else {
                    validos.push({ nome: nomeDaPlanilha, cpf, status: 'Pronto para importar' });
                }
            }
            try { if (req.file.path) fs.unlinkSync(req.file.path); } catch (e) { }
            return res.json({
                resumo: { total: data.length, validos: validos.length, duplicados: duplicados.length, invalidos: invalidos.length },
                detalhes: { validos, duplicados, invalidos }
            });
        } catch (error) {
            return res.status(500).json({ error: 'Erro na validação', details: error.message });
        }
    }

    async getOperadorasFiltro(req, res) {
        // [CÓDIGO MANTIDO EXATAMENTE IGUAL]
        try {
            if (!req.userId) return res.status(401).json({ error: 'Usuário não identificado. Verifique o token.' });
            const permission = await getOperadoraFilter(req.userId);
            if (!permission.authorized) {
                if (permission.emptyResult) return res.json([]);
                return res.status(permission.status).json({ error: permission.error });
            }
            let whereClause = {};
            if (permission.whereClause && permission.whereClause.operadora_id) {
                whereClause.id = permission.whereClause.operadora_id;
            }
            const operadoras = await Operadora.findAll({
                where: whereClause,
                attributes: ['id', 'nome'],
                order: [['nome', 'ASC']]
            });
            return res.json(operadoras);
        } catch (err) {
            console.error("Erro na rota operadoras-filtro:", err);
            return res.status(500).json({ error: 'Erro interno ao buscar operadoras para o filtro' });
        }
    }

    async toggleActive(req, res) {
        // [CÓDIGO MANTIDO EXATAMENTE IGUAL]
        const { id } = req.params;
        try {
            const paciente = await Pacientes.findByPk(id);
            if (!paciente) return res.status(404).json({ error: 'Paciente não encontrado' });
            const statusAtual = paciente.is_active !== false;
            await paciente.update({ is_active: !statusAtual });
            return res.json({
                message: `Paciente ${!statusAtual ? 'ativado' : 'inativado'} com sucesso!`,
                is_active: !statusAtual
            });
        } catch (err) {
            return res.status(500).json({ error: 'Erro ao alterar status do paciente', details: err.message });
        }
    }

    async show(req, res) {
        const { id } = req.params;
        try {
            const paciente = await Pacientes.findByPk(id, {
                include: [
                    {
                        model: Operadora,
                        as: 'operadoras',
                        attributes: ['id', 'nome']
                    },
                    {   // ADICIONADO AQUI TAMBÉM
                        model: Medicamentos,
                        as: 'medicamento',
                        attributes: ['id', 'nome', 'dosagem', 'price']
                    }
                ]
            });
            if (!paciente) return res.status(404).json({ error: 'Paciente não encontrado' });
            return res.json(paciente);
        } catch (err) {
            console.error("Erro no show de pacientes:", err);
            return res.status(500).json({ error: 'Erro ao buscar detalhes do paciente' });
        }
    }

    async getPending(req, res) {
        // [CÓDIGO MANTIDO EXATAMENTE IGUAL]
        try {
            const permission = await getOperadoraFilter(req.userId);
            if (!permission.authorized && !permission.emptyResult) {
                return res.status(permission.status).json({ error: permission.error });
            }
            const where = permission.whereClause || {};
            where.is_new_user = true;
            const pendentes = await Pacientes.findAll({
                where,
                attributes: ['id', 'nome', 'sobrenome'],
                order: [['createdAt', 'DESC']]
            });
            return res.json(pendentes);
        } catch (error) {
            console.error("Erro no getPending:", error);
            return res.status(500).json({ error: 'Erro ao buscar pacientes pendentes' });
        }
    }

    async confirmPatient(req, res) {
        // [CÓDIGO MANTIDO EXATAMENTE IGUAL]
        const { id } = req.params;
        try {
            const paciente = await Pacientes.findByPk(id);
            if (!paciente) return res.status(404).json({ error: 'Paciente não encontrado' });
            await paciente.update({ is_new_user: false });
            return res.json({ message: 'Cadastro de paciente confirmado com sucesso!' });
        } catch (err) {
            return res.status(500).json({ error: 'Erro ao confirmar paciente', details: err.message });
        }
    }

    async autoFillFromDocument(req, res) {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum documento enviado para análise.' });
        }

        try {
            const dadosExtraidos = await extrairDadosDocumento(req.file.path, req.file.mimetype);

            let medicamentos_sugeridos = [];

            // Se a IA encontrou um medicamento, faz a busca de similaridade
            if (dadosExtraidos.medicamento_extraido) {
                // Busca todos os medicamentos do banco
                const todosMedicamentos = await Medicamentos.findAll({ attributes: ['id', 'nome', 'dosagem'] });

                // Cria um array só com os nomes (+ dosagem) para o comparador
                const nomesBanco = todosMedicamentos.map(m => `${m.nome} ${m.dosagem ? m.dosagem : ''}`.trim());

                if (nomesBanco.length > 0) {
                    // Compara o extraído pela IA com todos do banco
                    const matches = stringSimilarity.findBestMatch(dadosExtraidos.medicamento_extraido, nomesBanco);

                    // Filtra apenas os que tem 70% (0.7) ou mais de semelhança e ordena do maior pro menor
                    medicamentos_sugeridos = matches.ratings
                        .map((resultado, index) => ({
                            ...todosMedicamentos[index].toJSON(),
                            rating: resultado.rating
                        }))
                        .filter(med => med.rating >= 0.70)
                        .sort((a, b) => b.rating - a.rating);
                }
            }

            try { fs.unlinkSync(req.file.path); } catch (e) { console.error("Erro ao apagar temp doc:", e) }

            // Retorna os dados da IA + o array de sugestões
            return res.json({
                ...dadosExtraidos,
                medicamentos_sugeridos
            });

        } catch (error) {
            console.error("Erro na extração por IA:", error);
            try { if (req.file.path) fs.unlinkSync(req.file.path); } catch (e) { }
            return res.status(500).json({ error: 'Erro ao analisar documento com a Inteligência Artificial.' });
        }
    }
}
export default new PacientesController();