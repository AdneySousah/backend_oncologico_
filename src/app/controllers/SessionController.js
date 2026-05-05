import * as Yup from 'yup'
import axios from 'axios'
import jwt from 'jsonwebtoken'
import authConfig from '../../config/auth.js'
import User from '../models/User.js'
import Operadora from '../models/Operadora.js' // <-- Import da Operadora adicionado

class SessionController {
    async store(req, res) {
        // 1. O frontend pode mandar email OU username aqui
        const schema = Yup.object({
            email: Yup.string().required(), // Mantemos como string genérica (sem .email())
            password: Yup.string().required()
        })

        try {
            await schema.validate(req.body, { abortEarly: false })
        } catch (err) {
            return res.status(400).json({ error: 'Validation fails', messages: err.errors })
        }

        const { email, password } = req.body
        const loginIdentifier = email.trim().toLowerCase(); // Pode ser 'assantos' ou o email

        try {
            // 2. Tenta autenticar na API Externa
            const response = await axios.post(
                process.env.END_POINT + '/api/login',
                {
                    username: loginIdentifier,
                    password: password
                },
                {
                    family: 4
                }
            );

            const externalUser = response.data.user;
            const externalCompany = externalUser.company;

            // ==========================================
            // 3. SINCRONIZAR A OPERADORA
            // ==========================================
            let operadora = null;
            const operadora_external = externalCompany.name === 'CLÍNICA DE INFUSÃO COMPARTILHADA' ? 'CICFARMA' : externalCompany.name;

            if (externalCompany && externalCompany.id) {
                operadora = await Operadora.findOne({
                    where: { external_id: externalCompany.id }
                });

                if (operadora) {
                    // MUDANÇA AQUI: usar operadora_external em vez de externalCompany.name
                    await operadora.update({ nome: operadora_external });
                } else {
                    // Fallback: procura pelo nome
                    operadora = await Operadora.findOne({ where: { nome: operadora_external } }); // MUDANÇA AQUI TAMBÉM

                    if (operadora) {
                        await operadora.update({ external_id: externalCompany.id });
                    } else {
                        // Cria a operadora caso não exista de forma alguma
                        operadora = await Operadora.create({
                            external_id: externalCompany.id,
                            nome: operadora_external,
                            cnpj: '00000000000000',
                            telefone: '00000000000',
                            email: []
                        });
                    }
                }
            }

            // ==========================================
            // 4. SINCRONIZAR O USUÁRIO
            // ==========================================
            let user = await User.findOne({
                where: { external_id: externalUser.id }
            });

            if (!user) {
                user = await User.findOne({
                    where: { email: externalUser.email }
                });
            }

            const permission_user = operadora_external === 'CICFARMA' ? 2 : 1;
            // Se o usuário existir, atualiza
            if (user) {
                await user.update({
                    external_id: externalUser.id,
                    username: externalUser.username,
                    name: externalUser.name,
                    active: externalUser.status === 0 ? true : false,
                    external_token: response.data.token.token
                });
            }
            // Se não existir, cria
            else {
                user = await User.create({
                    external_id: externalUser.id,
                    username: externalUser.username,
                    name: externalUser.name,
                    email: externalUser.email,
                    active: externalUser.status === 0 ? true : false,
                    is_profissional: false,
                    is_admin: operadora_external === 'CICFARMA' ? true : false,
                    perfil_id: permission_user,
                    password_hash: 'EXTERNAL_AUTH_' + Date.now(),
                    external_token: response.data.token.token
                });
            }

            // ==========================================
            // 5. VINCULAR USUÁRIO À OPERADORA
            // ==========================================
            // O Sequelize gera os métodos de associação dinamicamente baseado no "as: 'operadoras'"
            if (operadora && user) {

                await user.setOperadoras([operadora]);
            }

            // ==========================================
            // 6. GERAR TOKEN LOCAL E RETORNAR
            // ==========================================
            const localToken = jwt.sign({ id: user.id }, authConfig.secret, {
                expiresIn: authConfig.expiresIn,
            });

            return res.status(200).json({
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    username: user.username,
                    is_admin: user.is_admin,
                    is_profissional: user.is_profissional,
                    perfil_id: user.perfil_id
                },
                token: localToken
            });

        } catch (error) {
            console.error('Erro na autenticação externa:', error.response?.data || error.message);
            return res.status(401).json({ error: 'Usuário e/ou senha inválidos.' });
        }
    }
}

export default new SessionController()