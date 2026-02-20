import * as Yup from 'yup';
import Perfil from '../models/Perfil.js';

class PerfilController {
    // Lista todos os perfis (Para preencher a tabela no frontend)
    async index(req, res) {
        try {
            const perfis = await Perfil.findAll({
                order: [['id', 'ASC']]
            });
            return res.json(perfis);
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao buscar perfis', details: error.message });
        }
    }

    // Busca um perfil específico pelo ID (Para abrir a tela de edição no frontend)
    async show(req, res) {
        const { id } = req.params;

        try {
            const perfil = await Perfil.findByPk(id);

            if (!perfil) {
                return res.status(404).json({ error: 'Perfil não encontrado' });
            }

            return res.json(perfil);
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao buscar perfil', details: error.message });
        }
    }

    // Cria um novo perfil (Ex: "Recepcionista", "Médico")
    async store(req, res) {
        const schema = Yup.object({
            nome: Yup.string().required(),
            // Não exigimos 'permissoes' como required no YUP porque o model já tem o defaultValue do JSONB,
            // mas o frontend pode enviar um objeto de permissões modificado se quiser.
            permissoes: Yup.object().nullable() 
        });

        try {
            await schema.validate(req.body, { abortEarly: false });
        } catch (err) {
            return res.status(400).json({ error: 'Erro de validação', messages: err.inner });
        }

        try {
            // Verifica se o nome já existe
            const perfilExists = await Perfil.findOne({ where: { nome: req.body.nome } });
            if (perfilExists) {
                return res.status(400).json({ error: 'Já existe um perfil com este nome.' });
            }

            const perfil = await Perfil.create(req.body);
            return res.status(201).json(perfil);
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao criar perfil', details: error.message });
        }
    }

    // Atualiza o perfil (É AQUI que o frontend vai salvar quando você "ligar/desligar" as chavinhas)
    async update(req, res) {
        const { id } = req.params;

        const schema = Yup.object({
            nome: Yup.string(),
            permissoes: Yup.object()
        });

        try {
            await schema.validate(req.body, { abortEarly: false });
        } catch (err) {
            return res.status(400).json({ error: 'Erro de validação', messages: err.inner });
        }

        try {
            const perfil = await Perfil.findByPk(id);

            if (!perfil) {
                return res.status(404).json({ error: 'Perfil não encontrado' });
            }

            // Se estiver tentando mudar o nome, verifica se não vai dar conflito com outro perfil
            if (req.body.nome && req.body.nome !== perfil.nome) {
                const perfilExists = await Perfil.findOne({ where: { nome: req.body.nome } });
                if (perfilExists) {
                    return res.status(400).json({ error: 'Já existe um perfil com este nome.' });
                }
            }

            // O Sequelize substitui o objeto JSONB inteiro. O frontend deve enviar o objeto completo das permissões
            await perfil.update(req.body);

            return res.json(perfil);
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao atualizar perfil', details: error.message });
        }
    }
}

export default new PerfilController();