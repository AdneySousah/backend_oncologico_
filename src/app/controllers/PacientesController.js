import * as Yup from 'yup';
import Pacientes from '../models/Pacientes.js';
import Operadora from '../models/Operadora.js';
import getAdress from '../../utils/getAdress.js';
import PacientesAnexos from '../models/PacientesAnexos.js';
import User from '../models/User.js';
import Sequelize, { Op } from 'sequelize'; // Adicionamos o Sequelize aqui
import xlsx from 'xlsx';
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

            // Removemos a chamada antiga ao getAdress() daqui também.
            // Se o usuário alterou o CEP no frontend, o frontend já buscou 
            // as novas informações e as enviou dentro do req.body.
            
            await paciente.update(req.body);

            return res.json(paciente);
        } catch (err) {
            return res.status(500).json({ error: 'Erro ao atualizar paciente' });
        }
    }

    
    async index(req, res) {
        const { nome, cpf, operadora_id } = req.query;

        // 1. CHAMA O UTILITÁRIO
        const permission = await getOperadoraFilter(req.userId, operadora_id);

        if (!permission.authorized) {
            if (permission.emptyResult) return res.json([]); 
            return res.status(permission.status).json({ error: permission.error });
        }

        // 2. RECUPERA A TRAVA GERADA
        const where = permission.whereClause;

        // 3. ADICIONA OS OUTROS FILTROS NA MESMA VARIÁVEL 'WHERE'
        if (nome) {
            where[Op.or] = [
                { nome: { [Op.iLike]: `%${nome}%` } },
                { sobrenome: { [Op.iLike]: `%${nome}%` } }
            ];
        }

        if (cpf) {
            where.cpf = cpf.replace(/\D/g, '');
        }

        try {
            // 4. BUSCA NO BANCO
            const pacientes = await Pacientes.findAll({
                where, // A trava das operadoras + filtros de nome/cpf estão todos aqui dentro
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

        const successes = [];
        const errors = []; // <-- Declarado como 'errors' (inglês)
        const duplicates = [];

        try {
            const workbook = xlsx.readFile(req.file.path);
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const data = xlsx.utils.sheet_to_json(sheet);

            for (const row of data) {
                const cpfRaw = row['cpf'] || row['CPF'];
                const cpf = cpfRaw ? String(cpfRaw).replace(/\D/g, '') : null;
                const nome = row['nome'] || row['Nome'];

                if (!cpf || !nome) continue;

                const pacienteExists = await Pacientes.findOne({ where: { cpf } });
                if (pacienteExists) {
                    duplicates.push({ nome, cpf, motivo: 'CPF já cadastrado' });
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

                try {
                    await Pacientes.create({
                        nome: nome,
                        sobrenome: row['sobrenome'] || row['Sobrenome'],
                        celular: cleanString(row['celular'] || row['Celular']),
                        telefone: cleanString(row['telefone'] || row['Telefone']),
                        data_nascimento: row['data_nascimento'],
                        sexo: row['sexo'] || 'nao definido',
                        possui_cuidador: (row['possui_cuidador'] === 'SIM' || row['possui_cuidador'] === true),
                        nome_cuidador: cleanString(row['nome_cuidador']),
                        contato_cuidador: cleanString(row['contato_cuidador']),
                        cep: cep,
                        operadora_id: row['operadora_id'],
                        cpf: cpf,
                        logradouro: enderecoData.logradouro || 'N/A',
                        numero: cleanString(row['numero']) || 'S/N',
                        complemento: cleanString(row['complemento']),
                        bairro: enderecoData.bairro || '',
                        cidade: enderecoData.localidade || '',
                        estado: enderecoData.uf || ''
                    });
                    successes.push({ nome, cpf });
                } catch (err) {
                    console.error("Erro ao criar paciente:", err);
                    errors.push({ nome, cpf, erro: err.message }); // Adiciona ao array 'errors'
                }
            }

            try {
                if (req.file.path && !req.file.location) {
                    fs.unlinkSync(req.file.path);
                }
            } catch (fileErr) {
                console.warn("Aviso: Arquivo temporário preso pelo sistema.", fileErr.message);
            }

            // --- CORREÇÃO AQUI ---
            return res.json({
                message: 'Processamento concluído',
                summary: {
                    total_lido: data.length,
                    importados: successes.length,
                    duplicados: duplicates.length,
                    erros: errors.length // Aqui usamos errors.length
                },
                detalhes: {
                    duplicados: duplicates,
                    // ANTES ESTAVA ASSIM: erros
                    // COMO DEVE FICAR:
                    erros: errors // Mapeia a chave 'erros' para a variável 'errors'
                }
            });

        } catch (error) {
            console.error("Erro fatal na importação:", error);
            return res.status(500).json({ error: 'Falha ao processar arquivo Excel', details: error.message });
        }
    }


    async validateImport(req, res) {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
        }

        const validos = [];
        const duplicados = [];
        const invalidos = [];

        try {
            const workbook = xlsx.readFile(req.file.path);
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const data = xlsx.utils.sheet_to_json(sheet);

            for (const row of data) {
                const cpfRaw = row['cpf'] || row['CPF'];
                const cpf = cpfRaw ? String(cpfRaw).replace(/\D/g, '') : null;
                const nome = row['nome'] || row['Nome'];

                // 1. Validação Básica (Sem CPF ou Nome)
                if (!cpf || !nome) {
                    invalidos.push({ linha: row, motivo: 'Nome ou CPF ausente' });
                    continue;
                }

                // 2. Checagem no Banco
                const pacienteExists = await Pacientes.findOne({ where: { cpf } });

                if (pacienteExists) {
                    duplicados.push({
                        nome,
                        cpf,
                        motivo: 'CPF já cadastrado no sistema'
                    });
                } else {
                    validos.push({
                        nome,
                        cpf,
                        status: 'Pronto para importar'
                    });
                }
            }

            // Limpa o arquivo temporário
            try {
                if (req.file.path) fs.unlinkSync(req.file.path);
            } catch (e) { console.warn('Erro ao limpar temp:', e.message) }

            return res.json({
                resumo: {
                    total: data.length,
                    validos: validos.length,
                    duplicados: duplicados.length,
                    invalidos: invalidos.length
                },
                detalhes: {
                    validos,
                    duplicados, // Aqui vai a lista de quem já existe
                    invalidos
                }
            });

        } catch (error) {
            return res.status(500).json({ error: 'Erro na validação', details: error.message });
        }
    }
}

export default new PacientesController();