import * as Yup from 'yup';
import InfosComorbidade from '../models/InfosComorbidade.js';




class InfosComorbidadeController {
    async store(req, res){

        const schema = Yup.object({
            possui_comorbidade: Yup.boolean().required(),
            descricao_comorbidade: Yup.string().when('possui_comorbidade', {
                is: true,
                then: (schema) => schema.required('Descrição da comorbidade é obrigatória'),
                otherwise: (schema) => schema.notRequired()
            }),
            sabe_diagnostico: Yup.boolean().required(),
            descricao_diagnostico: Yup.string().when('sabe_diagnostico', {
                is: true,
                then: (schema) => schema.required('Descrição do diagnóstico é obrigatória'),
                otherwise: (schema) => schema.notRequired()
            }),
        })

        try {
            await schema.validate(req.body, { abortEarly: false });
        } catch (err) {
            return res.status(400).json({ error: 'Validation fails', messages: err.errors });
        }

        const infosComorbidade = await InfosComorbidade.create(req.body);
        return res.status(201).json(infosComorbidade);
    }
}



export default new InfosComorbidadeController();