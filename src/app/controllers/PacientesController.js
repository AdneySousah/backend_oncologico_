import * as Yup from 'yup';
import stringSimilarity from 'string-similarity';
import User from '../models/User.js';
import Pacientes from '../models/Pacientes.js';
import Operadora from '../models/Operadora.js';
import Medicamentos from '../models/Medicamentos.js'; 
import getAdress from '../../utils/getAdress.js';
import PacientesAnexos from '../models/PacientesAnexos.js';
import Sequelize, { Op } from 'sequelize';
import { parseExcel } from '../../utils/excelUtils.js';
import fs from 'fs';
import { getOperadoraFilter } from '../../utils/permissionUtils.js';
import { extrairDadosDocumento } from '../../services/openAiService.js';
import AuditService from '../../services/AuditService.js';

// Helper para formatar e validar celular para padrão WhatsApp (55 + DDD + 9 + Numero)
// Movido para fora da classe para evitar problemas de escopo (this)
const formatarCelularWhatsapp = (numero) => {
    if (!numero) return null;
    let limpo = String(numero).replace(/\D/g, ''); // Remove tudo que não é número
    
    // Se o usuário não digitou o 55, nós adicionamos
    if (limpo.length === 11 && !limpo.startsWith('55')) {
        limpo = '55' + limpo;
    }
    return limpo;
};

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
        req.body.operadora_id = Number(req.body.operadora_id);

        // Formatação prévia do celular para validação (chamando a função externa)
        if (req.body.celular) {
            req.body.celular = formatarCelularWhatsapp(req.body.celular);
        }
        if (req.body.telefone) {
            req.body.telefone = String(req.body.telefone).replace(/\D/g, '');
        }

        const permission = await getOperadoraFilter(req.userId, req.body.operadora_id);
        if (!permission.authorized) {
            return res.status(permission.status || 403).json({ error: permission.error || "Você não tem permissão para cadastrar pacientes nesta operadora." });
        }

        if (req.body.medicamento_id) {
            req.body.medicamento_id = Number(req.body.medicamento_id);
        } else {
            req.body.medicamento_id = null;
        }

        const schema = Yup.object({
            nome: Yup.string().required(),
            sobrenome: Yup.string().required(),
            celular: Yup.string()
                .required('Celular é obrigatório')
                .length(13, 'O celular deve ter o formato 55 + DDD + 9 + número (13 dígitos)'),
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

        const isCelular = await Pacientes.findOne({ where: { celular: req.body.celular } });
        if (isCelular) return res.status(400).json({ error: 'Celular já cadastrado para outro paciente.' });

        try {
            const currentUser = await User.findByPk(req.userId);
            const isAdmin = currentUser && (currentUser.is_admin === true || String(currentUser.is_admin).toLowerCase() === 'true' || currentUser.is_admin === 1);
            
            req.body.is_new_user = !isAdmin;

            const paciente = await Pacientes.create(req.body);

            if (req.files && req.files.length > 0) {
                let nomesAnexos = req.body.anexos_nomes || [];
                if (!Array.isArray(nomesAnexos)) nomesAnexos = [nomesAnexos];

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
                    { model: PacientesAnexos, as: 'anexos', attributes: ['id', 'nome', 'file_path', 'original_name'] },
                    { model: Medicamentos, as: 'medicamento', attributes: ['id', 'nome'] }
                ]
            });
            await AuditService.log(req.userId, 'Criação', 'Paciente', paciente.id, `Cadastrou o paciente ${req.body.nome} ${req.body.sobrenome} (CPF: ${req.body.cpf})`);
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
            if (!paciente) return res.status(404).json({ error: 'Paciente não encontrado' });

            // Formata celular se estiver vindo no update
            if (req.body.celular) {
                req.body.celular = formatarCelularWhatsapp(req.body.celular);
                
                // Validação manual para o update (Yup opcional aqui para brevidade)
                if (req.body.celular.length !== 13) {
                    return res.status(400).json({ error: 'O celular deve ter 13 dígitos (55 + DDD + 9 + número).' });
                }

                const isCelular = await Pacientes.findOne({
                    where: { celular: req.body.celular, id: { [Op.ne]: id } }
                });
                if (isCelular) return res.status(400).json({ error: 'Celular já cadastrado para outro paciente.' });
            }

            if (req.body.operadora_id && req.body.operadora_id !== paciente.operadora_id) {
                req.body.operadora_id = Number(req.body.operadora_id);
                const permission = await getOperadoraFilter(req.userId, req.body.operadora_id);
                if (!permission.authorized) {
                    return res.status(permission.status || 403).json({ error: permission.error || "Você não tem permissão para transferir este paciente." });
                }
            }

            if (req.body.cpf) {
                req.body.cpf = req.body.cpf.replace(/\D/g, '');
                const isCPF = await Pacientes.findOne({
                    where: { cpf: req.body.cpf, id: { [Op.ne]: id } }
                });
                if (isCPF) return res.status(400).json({ error: 'CPF já cadastrado para outro paciente.' });
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

            if (req.body.medicamento_id === '') req.body.medicamento_id = null;

            await paciente.update(req.body);

            const pacienteAtualizado = await Pacientes.findByPk(id, {
                include: [
                    { model: PacientesAnexos, as: 'anexos', attributes: ['id', 'nome', 'file_path', 'original_name'] },
                    { model: Medicamentos, as: 'medicamento', attributes: ['id', 'nome'] }
                ]
            });
            await AuditService.log(req.userId, 'Edição', 'Paciente', paciente.id, `Atualizou dados do paciente ${pacienteAtualizado.nome} (ID: ${paciente.id})`);
            return res.json(pacienteAtualizado);
        } catch (err) {
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
        if (cpf) where.cpf = cpf.replace(/\D/g, '');

        if (status_active === 'false') {
            where.is_active = false;
        } else if (status_active !== 'ambos' && status_active !== 'todos') {
            where.is_active = { [Op.not]: false };
        }

        try {
            const pacientes = await Pacientes.findAll({
                where,
                include: [
                    { model: Operadora, as: 'operadoras', attributes: ['id', 'nome'] },
                    { model: PacientesAnexos, as: 'anexos', attributes: ['id', 'nome', 'file_path', 'original_name'] },
                    { model: Medicamentos, as: 'medicamento', attributes: ['id', 'nome', 'dosagem'] }
                ],
                order: [['is_new_user', 'DESC'], ['nome', 'ASC']]
            });
            return res.json(pacientes);
        } catch (err) {
            return res.status(500).json({ error: 'Erro ao buscar pacientes' });
        }
    }

    async validateImport(req, res) {
        if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
        const { operadora_id } = req.body;
        const permission = await getOperadoraFilter(req.userId, operadora_id);
        if (!permission.authorized) return res.status(permission.status).json({ error: permission.error });

        try {
            const data = parseExcel(req.file.path);
            const validos = [];
            const duplicados = [];
            const invalidos = []; // <-- CORREÇÃO: Criado array de inválidos

            for (const row of data) {
                const cpf = String(row['cpf'] || row['CPF'] || '').replace(/\D/g, '');
                const nomeDaPlanilha = row['nome'] || row['Nome'];

                if (!cpf || !nomeDaPlanilha) {
                    invalidos.push({ motivo: 'Nome ou CPF faltando na planilha' });
                    continue;
                }

                const pacienteExists = await Pacientes.findOne({ where: { cpf } });
                if (pacienteExists) {
                    duplicados.push({ nome: nomeDaPlanilha, cpf, motivo: 'CPF já cadastrado' });
                } else {
                    validos.push({ nome: nomeDaPlanilha, cpf });
                }
            }
            if (req.file.path) fs.unlinkSync(req.file.path);
            
            // <-- CORREÇÃO: Adicionado invalidos no resumo e nos detalhes
            return res.json({ 
                resumo: { 
                    total: data.length, 
                    validos: validos.length, 
                    duplicados: duplicados.length,
                    invalidos: invalidos.length 
                }, 
                detalhes: { 
                    validos, 
                    duplicados,
                    invalidos 
                } 
            });
        } catch (error) {
            return res.status(500).json({ error: 'Erro na validação' });
        }
    }

    async importExcel(req, res) {
        if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
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
            const isNewUserFlag = !(currentUser && currentUser.is_admin);

            const formatarNome = (texto) => {
                if (!texto) return '';
                return texto.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
            };

            for (const row of data) {
                const cpfRaw = row['cpf'] || row['CPF'];
                const cpf = cpfRaw ? String(cpfRaw).replace(/\D/g, '') : null;
                const nomeDaPlanilha = row['nome'] || row['Nome'];

                if (!cpf || !nomeDaPlanilha) continue;

                let celularRaw = row['celular'] || row['Celular'];
                let celular = formatarCelularWhatsapp(celularRaw);

                const pacienteExists = await Pacientes.findOne({ where: { cpf } });
                if (pacienteExists) {
                    duplicates.push({ nome: nomeDaPlanilha, cpf, motivo: 'CPF já cadastrado' });
                    continue;
                }

                const cepRaw = row['cep'] || row['CEP'];
                const cep = cepRaw ? String(cepRaw).replace(/\D/g, '') : '';
                let enderecoData = {};

                if (cep && cep.length === 8) {
                    try {
                        const consultaEndereco = await getAdress(cep);
                        if (consultaEndereco && !consultaEndereco[0].erro) enderecoData = consultaEndereco[0];
                    } catch (err) {}
                }

                let dataNascimento = row['data_nascimento'] || row['Data_nascimento'] || null;
                if (typeof dataNascimento === 'number') {
                    const dataObj = new Date(Math.round((dataNascimento - 25569) * 86400 * 1000));
                    dataNascimento = dataObj.toISOString().split('T')[0];
                }

                try {
                    await Pacientes.create({
                        nome: formatarNome(nomeDaPlanilha),
                        sobrenome: formatarNome(String(row['sobrenome'] || row['Sobrenome'] || '')),
                        celular: celular || '5500000000000', 
                        telefone: String(row['telefone'] || row['Telefone'] || '').replace(/\D/g, ''),
                        data_nascimento: dataNascimento || new Date(),
                        sexo: row['sexo'] || row['Sexo'] || 'nao definido',
                        possui_cuidador: (String(row['possui_cuidador']).toUpperCase() === 'SIM' || row['possui_cuidador'] === true),
                        nome_cuidador: String(row['nome_cuidador'] || ''),
                        contato_cuidador: String(row['contato_cuidador'] || ''),
                        cep: cep,
                        operadora_id: Number(operadora_id),
                        medicamento_id: row['medicamento_id'] ? Number(row['medicamento_id']) : null,
                        cpf: cpf,
                        logradouro: enderecoData.logradouro || 'N/A',
                        numero: String(row['numero'] || 'S/N'),
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

            if (req.file.path) fs.unlinkSync(req.file.path);
            await AuditService.log(req.userId, 'Importação', 'Paciente', null, `Importou ${successes.length} pacientes.`);
            
            // <-- CORREÇÃO: Retornando o objeto "detalhes" com a chave "erros" que o frontend espera
            return res.json({ 
                message: 'Processamento concluído', 
                summary: { 
                    total: data.length, 
                    importados: successes.length, 
                    duplicados: duplicates.length, 
                    erros: errors.length 
                },
                detalhes: {
                    erros: errors,
                    sucessos: successes,
                    duplicados: duplicates
                }
            });
        } catch (error) {
            return res.status(500).json({ error: 'Falha no Excel', details: error.message });
        }
    }
    async getOperadorasFiltro(req, res) {
        try {
            const permission = await getOperadoraFilter(req.userId);
            let whereClause = {};
            if (permission.whereClause && permission.whereClause.operadora_id) whereClause.id = permission.whereClause.operadora_id;
            const operadoras = await Operadora.findAll({ where: whereClause, attributes: ['id', 'nome'], order: [['nome', 'ASC']] });
            return res.json(operadoras);
        } catch (err) {
            return res.status(500).json({ error: 'Erro ao buscar operadoras' });
        }
    }

    async toggleActive(req, res) {
        const { id } = req.params;
        try {
            const paciente = await Pacientes.findByPk(id);
            if (!paciente) return res.status(404).json({ error: 'Paciente não encontrado' });
            const novoStatus = paciente.is_active === false;
            await paciente.update({ is_active: novoStatus });
            return res.json({ message: 'Status alterado', is_active: novoStatus });
        } catch (err) {
            return res.status(500).json({ error: 'Erro ao alterar status' });
        }
    }

    async show(req, res) {
        const { id } = req.params;
        try {
            const paciente = await Pacientes.findByPk(id, {
                include: [
                    { model: Operadora, as: 'operadoras', attributes: ['id', 'nome'] },
                    { model: Medicamentos, as: 'medicamento', attributes: ['id', 'nome', 'dosagem', 'price'] }
                ]
            });
            return res.json(paciente);
        } catch (err) {
            return res.status(500).json({ error: 'Erro ao buscar paciente' });
        }
    }

    async getPending(req, res) {
        try {
            const permission = await getOperadoraFilter(req.userId);
            const where = permission.whereClause || {};
            where.is_new_user = true;
            const pendentes = await Pacientes.findAll({ where, attributes: ['id', 'nome', 'sobrenome'], order: [['createdAt', 'DESC']] });
            return res.json(pendentes);
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao buscar pendentes' });
        }
    }

    async confirmPatient(req, res) {
        const { id } = req.params;
        try {
            const paciente = await Pacientes.findByPk(id);
            await paciente.update({ is_new_user: false });
            return res.json({ message: 'Confirmado' });
        } catch (err) {
            return res.status(500).json({ error: 'Erro ao confirmar' });
        }
    }

    async autoFillFromDocument(req, res) {
        if (!req.file) return res.status(400).json({ error: 'Sem arquivo' });
        try {
            const dadosExtraidos = await extrairDadosDocumento(req.file.path, req.file.mimetype);
            let medicamentos_sugeridos = [];
            if (dadosExtraidos.medicamento_extraido) {
                const todosMedicamentos = await Medicamentos.findAll({ attributes: ['id', 'nome', 'dosagem'] });
                const nomesBanco = todosMedicamentos.map(m => `${m.nome} ${m.dosagem || ''}`.trim());
                if (nomesBanco.length > 0) {
                    const matches = stringSimilarity.findBestMatch(dadosExtraidos.medicamento_extraido, nomesBanco);
                    medicamentos_sugeridos = matches.ratings
                        .map((resultado, index) => ({ ...todosMedicamentos[index].toJSON(), rating: resultado.rating }))
                        .filter(med => med.rating >= 0.70)
                        .sort((a, b) => b.rating - a.rating);
                }
            }
            if (req.file.path) fs.unlinkSync(req.file.path);
            return res.json({ ...dadosExtraidos, medicamentos_sugeridos });
        } catch (error) {
            if (req.file.path) fs.unlinkSync(req.file.path);
            return res.status(500).json({ error: 'Erro na IA' });
        }
    }
}

export default new PacientesController();