
import * as Yup from 'yup';

import Medicamentos from '../models/Medicamentos.js';

class MedicamentosController {
    async store(req, res) {
        const schema = Yup.object({
            nome: Yup.string().required(),
            dosagem: Yup.string().required(),
            tipo_dosagem: Yup.string().oneOf(['MG', 'G', 'MCG', 'UI', 'ML', 'MG/ML']),
            codigo_tuss: Yup.string(),
            laboratorio: Yup.string(),
            tipo_produto: Yup.string(),
            principio_ativo: Yup.string(),
            descricao: Yup.string(),
            qtd_capsula: Yup.number(),
            nome_comercial: Yup.string(),
        });

        try {
            await schema.validate(req.body, { abortEarly: false });
        } catch (err) {
            return res.status(400).json({ error: 'Validation fails', messages: err.inner });
        }

        const { nome,dosagem,tipo_dosagem,codigo_tuss,laboratorio,tipo_produto,principio_ativo,descricao,qtd_capsula,nome_comercial } = req.body;

        // Sugestão de ajuste no Backend (store)
        const medicamentoExists = await Medicamentos.findOne({ where: { nome } });
        if (medicamentoExists) {
            return res.status(400).json({ error: 'Medicamento já cadastrado.' });
        }
        const novoMedicamento = await Medicamentos.create({ nome,dosagem,tipo_dosagem,codigo_tuss,laboratorio,tipo_produto,principio_ativo,descricao,qtd_capsula,nome_comercial });
        return res.status(201).json(novoMedicamento);
    }

    async index(req, res) {
        const medicamentos = await Medicamentos.findAll();
        return res.status(200).json(medicamentos);
    }


}


export default new MedicamentosController();