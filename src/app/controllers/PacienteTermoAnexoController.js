import PacienteTermoAnexo from '../models/PacienteTermoAnexo.js';
import Pacientes from '../models/Pacientes.js';

class PacienteTermoAnexoController {
    // Rota para fazer upload de um novo termo assinado
    async store(req, res) {
        const { paciente_id } = req.params;

        try {
            const paciente = await Pacientes.findByPk(paciente_id);
            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }

            if (!req.file) {
                return res.status(400).json({ error: 'Nenhum arquivo foi enviado' });
            }

            const { originalname: nome_original, filename: arquivo_path } = req.file;

            const anexo = await PacienteTermoAnexo.create({
                paciente_id,
                arquivo_path,
                nome_original,
            });

            // Opcional: Atualiza o status do paciente para 'Aceito' se fizer sentido no fluxo
            paciente.status_termo = 'Aceito';
            await paciente.save();

            return res.status(201).json(anexo);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Erro ao salvar o anexo do termo.' });
        }
    }


  

    // Rota para listar TODOS os termos (Visão Gerencial)
    async index(req, res) {
        try {
            const anexos = await PacienteTermoAnexo.findAll({
                include: [
                    {
                        model: Pacientes, // Confirme se importou o model Pacientes no topo do controller
                        as: 'paciente',   // O alias deve ser exatamente o que está no seu model: this.belongsTo(..., { as: 'paciente' })
                        attributes: ['id', 'nome', 'sobrenome', 'cpf'] // Traz só o necessário para a listagem
                    }
                ],
                order: [['created_at', 'DESC']],
            });

            return res.json(anexos);
        } catch (error) {
            console.error("Erro ao listar todos os termos anexos:", error);
            return res.status(500).json({ error: 'Erro ao buscar todos os anexos.' });
        }
    }
}

export default new PacienteTermoAnexoController();