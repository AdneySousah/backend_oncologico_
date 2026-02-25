import * as Yup from 'yup';
import Pacientes from '../models/Pacientes.js';
import Operadora from '../models/Operadora.js';
import getAdress from '../../utils/getAdress.js';
import PacientesAnexos from '../models/PacientesAnexos.js';
import Sequelize, { Op } from 'sequelize'; // Adicionamos o Sequelize aqui
import { parseExcel } from '../../utils/excelUtils.js';
import fs from 'fs';
import { getOperadoraFilter } from '../../utils/permissionUtils.js';

class PacientesController {

    async getNomesAnexos(req, res) {
        try {
            // Busca apenas nomes distintos para popular o frontend
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


    // --- STORE (MANUAL) COMPLETO ---
    async store(req, res) {
        // Como o frontend agora envia FormData (por causa dos arquivos), 
        // tudo chega como string. Precisamos converter os tipos antes de validar.
        req.body.possui_cuidador = req.body.possui_cuidador === 'true';
        req.body.fez_entrevista = req.body.fez_entrevista === 'true';
        req.body.operadora_id = Number(req.body.operadora_id);

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
            cpf: Yup.string().required(),
            fez_entrevista: Yup.boolean().default(false),
            // Campos de endereço
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

        const isCPF = await Pacientes.findOne({ where: { cpf: req.body.cpf.replace(/\D/g, '') } });
        if (isCPF) {
            return res.status(400).json({ error: 'CPF já cadastrado para outro paciente.' });
        }

        const isCelular = await Pacientes.findOne({ where: { celular: req.body.celular.replace(/\D/g, '') } });
        if (isCelular) {
            return res.status(400).json({ error: 'Celular já cadastrado para outro paciente.' });
        }

        const istelefone = await Pacientes.findOne({ where: { telefone: req.body.telefone.replace(/\D/g, '') } });
        if (istelefone) {
            return res.status(400).json({ error: 'Telefone já cadastrado para outro paciente.' });
        }

        try {
            // 1. Cria o paciente principal
            const paciente = await Pacientes.create(req.body);

            // 2. Salva os anexos (se houver arquivos enviados)
            if (req.files && req.files.length > 0) {
                // req.body.anexos_nomes pode vir como string (se for 1 arquivo) 
                // ou array de strings (se forem 2 ou mais).
                let nomesAnexos = req.body.anexos_nomes || [];
                if (!Array.isArray(nomesAnexos)) {
                    nomesAnexos = [nomesAnexos];
                }

                // Monta o array de objetos para salvar no banco de uma vez
                const anexosData = req.files.map((file, index) => ({
                    paciente_id: paciente.id,
                    nome: nomesAnexos[index] || 'Sem Nome',
                    file_path: file.filename, // Nome gerado pelo uuid no multer
                    original_name: file.originalname
                }));

                await PacientesAnexos.bulkCreate(anexosData);
            }

            return res.status(201).json(paciente);
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: 'Erro ao cadastrar paciente', details: err.message });
        }
    }


    // --- UPDATE ---
    async update(req, res) {
        const { id } = req.params;

        try {
            const paciente = await Pacientes.findByPk(id);

            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }

            const isCPF = await Pacientes.findOne({ where: { cpf: req.body.cpf.replace(/\D/g, ''), id: { [Op.ne]: id } } });

            await paciente.update(req.body);

            return res.json(paciente);
        } catch (err) {
            return res.status(500).json({ error: 'Erro ao atualizar paciente' });
        }
    }


   async index(req, res) {
        // Adicionamos 'status_active' nos parâmetros de query
        const { nome, cpf, operadora_id, status_active } = req.query;

        // 1. CHAMA O UTILITÁRIO
        const permission = await getOperadoraFilter(req.userId, operadora_id);

        if (!permission.authorized) {
            if (permission.emptyResult) return res.json([]);
            return res.status(permission.status).json({ error: permission.error });
        }

        // 2. RECUPERA A TRAVA GERADA
        const where = permission.whereClause;

        // 3. ADICIONA OS OUTROS FILTROS
        if (nome) {
            where[Op.or] = [
                { nome: { [Op.iLike]: `%${nome}%` } },
                { sobrenome: { [Op.iLike]: `%${nome}%` } }
            ];
        }

        if (cpf) {
            where.cpf = cpf.replace(/\D/g, '');
        }

        // --- LÓGICA DO FILTRO DE ATIVOS/INATIVOS AJUSTADA ---
        // Se vier 'false', pega estritamente os inativos (false)
        if (status_active === 'false') {
            where.is_active = false;
        } 
        // Se vier 'ambos' ou 'todos', a gente NÃO ADICIONA NENHUM FILTRO (traz todos)
        else if (status_active === 'ambos' || status_active === 'todos') {
            // Não faz nada, a query não filtra por is_active
        } 
        // CASO PADRÃO: Se vier 'true' ou NÃO VIER NADA (undefined), traz apenas os ATIVOS
        // Usamos { [Op.not]: false } para garantir que pacientes antigos (onde is_active é null) também venham
        else {
            where.is_active = { [Op.not]: false }; 
        }

        try {
            // 4. BUSCA NO BANCO
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
                    }
                ],
                order: [['nome', 'ASC']]
            });

            return res.json(pacientes);
        } catch (err) {
            console.error("Erro no index de pacientes:", err);
            return res.status(500).json({ error: 'Erro ao buscar pacientes' });
        }
    }

    async update(req, res) {
        const { id } = req.params;


        try {
            const paciente = await Pacientes.findByPk(id);

            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }


            // Se o CEP mudar, você pode opcionalmente re-consultar o getAdress
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



            await paciente.update(req.body);

            return res.json(paciente);
        } catch (err) {
            return res.status(500).json({ error: err.message || 'Erro ao atualizar paciente' });
        }
    }


    // --- IMPORT EXCEL ---
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

            for (const row of data) {
                // Formatação preventiva das chaves (aceita minúsculo ou maiúsculo)
                const cpfRaw = row['cpf'] || row['CPF'];
                const cpf = cpfRaw ? String(cpfRaw).replace(/\D/g, '') : null;
                const nomeDaPlanilha = row['nome'] || row['Nome'];

                if (!cpf || !nomeDaPlanilha) continue;

                // 1. VALIDAÇÃO EXCLUSIVA DE CPF NO BANCO
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

                // Correção de Data caso o Excel envie como número (Serial Date do Excel)
                let dataNascimento = row['data_nascimento'] || row['Data_nascimento'] || null;
                if (typeof dataNascimento === 'number') {
                    const dataObj = new Date(Math.round((dataNascimento - 25569) * 86400 * 1000));
                    dataNascimento = dataObj.toISOString().split('T')[0]; // Converte para YYYY-MM-DD
                }

                try {
                    // Preenchendo fallbacks ('Não informado', 'N/A') para evitar rejeição do Banco
                    await Pacientes.create({
                        nome: nomeDaPlanilha,
                        sobrenome: cleanString(row['sobrenome'] || row['Sobrenome']),
                        celular: cleanString(row['celular'] || row['Celular']) || 'Não informado',
                        telefone: cleanString(row['telefone'] || row['Telefone']),
                        data_nascimento: dataNascimento || new Date(),
                        sexo: row['sexo'] || row['Sexo'] || 'nao definido',
                        possui_cuidador: (String(row['possui_cuidador']).toUpperCase() === 'SIM' || row['possui_cuidador'] === true),
                        nome_cuidador: cleanString(row['nome_cuidador'] || row['Nome_cuidador']),
                        contato_cuidador: cleanString(row['contato_cuidador'] || row['Contato_cuidador']),
                        cep: cep,
                        operadora_id: Number(operadora_id),
                        cpf: cpf,
                        logradouro: enderecoData.logradouro || 'N/A',
                        numero: cleanString(row['numero'] || row['Numero']) || 'S/N',
                        complemento: cleanString(row['complemento'] || row['Complemento']),
                        bairro: enderecoData.bairro || 'N/A',
                        cidade: enderecoData.localidade || 'N/A',
                        estado: enderecoData.uf || 'N/A'
                    });
                    successes.push({ nome: nomeDaPlanilha, cpf });
                } catch (err) {
                    // Se o banco rejeitar por outro motivo, capturamos o erro exato
                    errors.push({ nome: nomeDaPlanilha, cpf, erro: err.message });
                }
            }

            try {
                if (req.file.path) fs.unlinkSync(req.file.path);
            } catch (fileErr) { }

            return res.json({
                message: 'Processamento concluído',
                summary: {
                    total_lido: data.length,
                    importados: successes.length,
                    duplicados: duplicates.length,
                    erros: errors.length
                },
                detalhes: {
                    duplicados: duplicates,
                    erros: errors
                }
            });

        } catch (error) {
            return res.status(500).json({ error: 'Falha ao processar arquivo Excel', details: error.message });
        }
    }

    // --- VALIDAR IMPORT (EXIBE A QUEM O CPF PERTENCE) ---
    async validateImport(req, res) {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
        }

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

                // 1. VALIDAÇÃO EXCLUSIVA DE CPF NO BANCO
                const pacienteExists = await Pacientes.findOne({ where: { cpf } });

                if (pacienteExists) {
                    // Busca quem é o dono desse CPF no banco
                    const nomeDoBanco = `${pacienteExists.nome} ${pacienteExists.sobrenome || ''}`.trim();
                    duplicados.push({
                        nome: nomeDaPlanilha, // Nome que o usuário tentou importar
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

    // --- NOVO MÉTODO PARA ALIMENTAR O SELECT DO FRONTEND ---
    async getOperadorasFiltro(req, res) {
        // Usa a sua mesma trava, mas sem passar ID específico
        const permission = await getOperadoraFilter(req.userId);

        if (!permission.authorized) {
            if (permission.emptyResult) return res.json([]);
            return res.status(permission.status).json({ error: permission.error });
        }

        let whereClause = {};
        if (permission.whereClause.operadora_id) {
            whereClause.id = permission.whereClause.operadora_id; // Ajusta de operadora_id para id
        }

        try {
            // Se for Clínica/Admin, whereClause é {}, e traz todas.
            // Se não for, traz apenas as permitidas na cláusula.
            const operadoras = await Operadora.findAll({
                where: whereClause,
                attributes: ['id', 'nome'],
                order: [['nome', 'ASC']]
            });

            return res.json(operadoras);
        } catch (err) {
            return res.status(500).json({ error: 'Erro ao buscar operadoras para o filtro' });
        }
    }

    // --- NOVO: ALTERNAR STATUS (ATIVO/INATIVO) ---
    async toggleActive(req, res) {
        const { id } = req.params;

        try {
            const paciente = await Pacientes.findByPk(id);

            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }

            // Se for nulo no banco, consideramos que o padrão era true.
            // Inverte o valor atual.
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




}
export default new PacientesController();